# Klaten English Community — From Us to Us

Event registration and door check-in website for the Klaten English Community meetup **"From Us to Us"** (Sunday, 29 November, 09.00 AM, Jendela Hub 2nd Floor).

- Visitors see the event info, rundown and a live 35-seat map, then save a seat and receive a QR ticket (downloadable as an image).
- Each WhatsApp number can register only once; tickets can be cancelled (until checked in).
- Admins log in to scan QR tickets with the phone camera (or type the 6-character code) and see/manage the guest list.

## Tech

- Static HTML/CSS/JS in `public/` (no build step), QR via `qrcode-generator`, scanning via `jsQR`
- Netlify Function `netlify/functions/api.ts` at `/api`
- Netlify Database (Postgres) with Drizzle ORM (`db/schema.ts`, migrations in `netlify/database/migrations/`)
- Netlify Image CDN for the logo

## Run locally

```bash
npm install
netlify dev
```

## Admin login

The admin credentials come from the `ADMIN_PHONE` and `ADMIN_PASSWORD` environment variables. If those aren't set, the defaults from the original script apply (phone `6285726801206`, password `1234`). Set your own password before the event.
