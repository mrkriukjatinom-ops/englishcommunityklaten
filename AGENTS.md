# AGENTS.md

## Architecture
- `public/index.html` — the whole frontend (single file, vanilla JS, screen switching via `.screen.active`). Ported from a Google Apps Script web app; keep it framework-free.
- `public/img/logo.png` — community logo; always reference through `/.netlify/images?url=/img/logo.png&w=...`.
- `netlify/functions/api.ts` — single action-based JSON endpoint at `/api` (POST `{ action, ... }`). Actions: `seats`, `register`, `mine`, `cancel`, `login`, `logout`, `list`, `checkin`, `setcheck`. Admin actions require a `token` from `login`.
- `db/schema.ts` — Drizzle schema (`registrations`, `admin_sessions`). `db/index.ts` — Drizzle client (`drizzle-orm/netlify-db`).

## Conventions / decisions
- Phone numbers are normalized to `62…` format; phone is UNIQUE, so a cancelled registration still blocks re-registering (original rule: "registration and cancellation can only be done once").
- Seat cap (35) is enforced inside a transaction with `pg_advisory_xact_lock` to avoid overbooking.
- Ticket codes: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. QR payload: `KEC|CODE|NAME|PHONE`.
- Admin creds via env `ADMIN_PHONE` / `ADMIN_PASSWORD` (fallback to the original defaults). Sessions live 12h in `admin_sessions`; the token is kept in `sessionStorage`.
- Schema changes: edit `db/schema.ts`, then `npx drizzle-kit generate --name <name>`. Never apply migrations manually. Use `drizzle-orm@beta` / `drizzle-kit@beta`.
- Event details (date, venue, rundown, seat count) are hardcoded in `index.html` and `MAX_SEATS` in `api.ts`. Keep them in sync.
