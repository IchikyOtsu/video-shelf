# Shelf

A deliberately calm, multi-format RSS aggregator for articles, videos, podcasts and newsletters.

## Database (Vercel + Neon)

This app uses Postgres through Drizzle. The schema supports users, sources, imported items, and per-user reading state.

1. Import the repository in Vercel.
2. In the project dashboard open **Storage** → **Create Database** → **Neon**, then connect it to this project. Vercel adds `DATABASE_URL` automatically.
3. Locally run `npm i -g vercel && vercel link`, then `vercel env pull .env.local`.
4. Add a long random `AUTH_SECRET` in Vercel → Settings → Environment Variables (for example: `openssl rand -base64 32`).
5. Create and apply migrations with `npm run db:generate && npm run db:migrate`.

Alternatively run `vercel integration add neon` interactively from the project folder.

## Commands

```bash
npm run dev
npm run db:generate
npm run db:migrate
```

Authentication uses secure HTTP-only session cookies and password hashes. The next feature is a server-side RSS importer that persists sources and items through `src/db`.

## Automatic YouTube refresh

Vercel calls `/api/cron/sync` once per day at 08:00 UTC. Add a `CRON_SECRET` environment variable in Vercel (a different random value from `AUTH_SECRET`). Vercel sends this secret automatically to the Cron route.
