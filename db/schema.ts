import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

// One row per registration. Phone is unique: a number can register only once
// (a cancelled registration still blocks re-registering, as in the original rules).
export const registrations = pgTable("registrations", {
  id: serial().primaryKey(),
  code: text().notNull().unique(),
  name: text().notNull(),
  phone: text().notNull().unique(),
  status: text().notNull().default("registered"), // "registered" | "cancelled"
  checkedIn: boolean("checked_in").notNull().default(false),
  checkedInAt: timestamp("checked_in_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at"),
});

// Admin login sessions (replaces the Apps Script CacheService tokens).
export const adminSessions = pgTable("admin_sessions", {
  token: text().primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
});
