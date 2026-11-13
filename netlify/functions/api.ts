import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "../../db/index.js";
import { adminSessions, registrations } from "../../db/schema.js";

const MAX_SEATS = 35;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
const SESSION_HOURS = 12;

type Payload = Record<string, unknown>;
type Result = Record<string, unknown>;

function normalizePhone(raw: unknown): string {
  if (!raw) return "";
  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.substring(1);
  if (digits.startsWith("0")) digits = "62" + digits.substring(1);
  return digits;
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function getSeatsSummary(): Promise<Result> {
  const [row] = await db
    .select({
      registered: sql<number>`count(*) filter (where ${registrations.status} = 'registered')::int`,
      checkedIn: sql<number>`count(*) filter (where ${registrations.status} = 'registered' and ${registrations.checkedIn})::int`,
    })
    .from(registrations);
  return { ok: true, registered: row?.registered ?? 0, checkedIn: row?.checkedIn ?? 0, total: MAX_SEATS };
}

async function registerParticipant(rawName: unknown, rawPhone: unknown): Promise<Result> {
  const name = String(rawName ?? "").trim().slice(0, 100);
  const phone = normalizePhone(rawPhone);
  if (!name) return { ok: false, error: "invalid", message: "Please enter your name." };
  if (!phone || phone.length < 9 || phone.length > 15) {
    return { ok: false, error: "invalid", message: "Please enter a valid WhatsApp number." };
  }

  // Serialize registrations with an advisory lock so the seat cap can't be exceeded.
  const client = await getDatabase().pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(29112026)");

    const existing = await client.query("SELECT 1 FROM registrations WHERE phone = $1", [phone]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "exists",
        message: "This number has already registered or cancelled. Registration is allowed only once.",
      };
    }

    const count = await client.query("SELECT count(*)::int AS n FROM registrations WHERE status = 'registered'");
    if ((count.rows[0]?.n ?? 0) >= MAX_SEATS) {
      await client.query("ROLLBACK");
      return { ok: false, error: "full", message: `All ${MAX_SEATS} seats are taken. Registration is full.` };
    }

    let code = randomCode();
    for (let attempt = 0; attempt < 20; attempt++) {
      const taken = await client.query("SELECT 1 FROM registrations WHERE code = $1", [code]);
      if (taken.rows.length === 0) break;
      code = randomCode();
    }

    await client.query("INSERT INTO registrations (code, name, phone) VALUES ($1, $2, $3)", [code, name, phone]);
    await client.query("COMMIT");
    return { ok: true, code, name, phone };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function findTicket(rawPhone: unknown, rawCode: unknown) {
  const phone = normalizePhone(rawPhone);
  const code = String(rawCode ?? "").toUpperCase().trim();
  if (!phone || !code) return null;
  const [row] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.code, code), eq(registrations.phone, phone)));
  return row ?? null;
}

async function getMyTicket(rawPhone: unknown, rawCode: unknown): Promise<Result> {
  const row = await findTicket(rawPhone, rawCode);
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, code: row.code, name: row.name, phone: row.phone, status: row.status, checkedIn: row.checkedIn };
}

async function cancelTicket(rawPhone: unknown, rawCode: unknown): Promise<Result> {
  const row = await findTicket(rawPhone, rawCode);
  if (!row) return { ok: false, error: "Ticket not found." };
  if (row.status === "cancelled") return { ok: true, message: "Already cancelled." };
  if (row.checkedIn) return { ok: false, error: "Cannot cancel a ticket that has already been checked in." };
  await db
    .update(registrations)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(registrations.id, row.id));
  return { ok: true };
}

async function adminLogin(rawPhone: unknown, password: unknown): Promise<Result> {
  const adminPhone = normalizePhone(process.env.ADMIN_PHONE || "6285726801206");
  const adminPassword = String(process.env.ADMIN_PASSWORD || "1234");
  const phone = normalizePhone(rawPhone);
  const pass = String(password ?? "");
  if (!phone || !safeEqual(phone, adminPhone) || !safeEqual(pass, adminPassword)) {
    return { ok: false, error: "Wrong number or password." };
  }
  const token = randomUUID();
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
  await db.insert(adminSessions).values({ token, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600 * 1000) });
  return { ok: true, token };
}

async function validateAdminToken(token: unknown): Promise<boolean> {
  if (!token || typeof token !== "string") return false;
  const [row] = await db
    .select({ token: adminSessions.token })
    .from(adminSessions)
    .where(and(eq(adminSessions.token, token), gt(adminSessions.expiresAt, new Date())));
  return Boolean(row);
}

async function adminLogout(token: unknown): Promise<Result> {
  if (typeof token === "string" && token) await db.delete(adminSessions).where(eq(adminSessions.token, token));
  return { ok: true };
}

async function getAdminList(): Promise<Result> {
  const rows = await db.select().from(registrations).orderBy(desc(registrations.createdAt));
  const active = rows.filter((r) => r.status === "registered");
  return {
    ok: true,
    registered: active.length,
    checkedIn: active.filter((r) => r.checkedIn).length,
    total: MAX_SEATS,
    list: rows.map((r) => ({
      code: r.code,
      name: r.name,
      phone: r.phone,
      status: r.status,
      checkedIn: r.checkedIn,
      checkedInAt: r.checkedInAt,
      createdAt: r.createdAt,
    })),
  };
}

async function processCheckIn(rawCode: unknown): Promise<Result> {
  const code = String(rawCode ?? "").toUpperCase().trim();
  if (!code) return { ok: false, error: "Missing ticket code." };
  const [row] = await db.select().from(registrations).where(eq(registrations.code, code));
  if (!row) return { ok: false, error: "not_found", code };
  if (row.status === "cancelled") return { ok: false, error: "cancelled", name: row.name, code };
  if (row.checkedIn) return { ok: false, error: "already", name: row.name, code };
  const updated = await db
    .update(registrations)
    .set({ checkedIn: true, checkedInAt: new Date() })
    .where(and(eq(registrations.id, row.id), eq(registrations.checkedIn, false)))
    .returning({ id: registrations.id });
  if (updated.length === 0) return { ok: false, error: "already", name: row.name, code };
  return { ok: true, name: row.name, code };
}

async function toggleCheckIn(rawCode: unknown, value: unknown): Promise<Result> {
  const code = String(rawCode ?? "").toUpperCase().trim();
  const isChecked = value === true || value === "true";
  const updated = await db
    .update(registrations)
    .set({ checkedIn: isChecked, checkedInAt: isChecked ? new Date() : null })
    .where(and(eq(registrations.code, code), eq(registrations.status, "registered")))
    .returning({ code: registrations.code });
  if (updated.length === 0) return { ok: false, error: "Code not found." };
  return { ok: true, code, checkedIn: isChecked };
}

async function handle(data: Payload): Promise<Result> {
  const action = String(data.action ?? "seats").trim();
  switch (action) {
    case "seats":
      return getSeatsSummary();
    case "register":
      return registerParticipant(data.name, data.phone);
    case "mine":
      return getMyTicket(data.phone, data.code);
    case "cancel":
      return cancelTicket(data.phone, data.code);
    case "login":
      return adminLogin(data.phone, data.password);
    case "logout":
      return adminLogout(data.token);
    case "list":
    case "checkin":
    case "setcheck": {
      if (!(await validateAdminToken(data.token))) return { ok: false, error: "Unauthorized" };
      if (action === "list") return getAdminList();
      if (action === "checkin") return processCheckIn(data.code);
      return toggleCheckIn(data.code, data.value);
    }
    default:
      return { ok: false, error: "Unknown action: " + action };
  }
}

export default async (req: Request) => {
  let data: Payload = {};
  if (req.method === "POST") {
    try {
      data = (await req.json()) as Payload;
    } catch {
      data = {};
    }
  } else if (req.method === "GET") {
    data = Object.fromEntries(new URL(req.url).searchParams);
  } else {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const result = await handle(data);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("API error", err);
    return Response.json({ ok: false, error: "Server error. Please try again." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api",
};
