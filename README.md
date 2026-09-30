# Shelf

A personal feed aggregator with an inbox, a complete collected library, saved items, archives, and source management. Video feeds are the first supported format, with YouTube as the first provider.

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

Authentication uses secure HTTP-only session cookies and password hashes. Sources, collected items, and saved/archived states are stored per account in Postgres. The previous browser-only saved/viewed choices are transferred on sign-in when available.

## Aggregator workflow

- **Boîte de réception**: collected videos that have not been archived. Opening a player does not automatically archive a video.
- **Bibliothèque**: all collected videos, including archived and saved ones. Search, source filters, oldest/newest sorting, and pagination work across the complete collection.
- **À retrouver**: saved items, independent of whether they are archived.
- **Archives**: processed items. Restore an item to put it back in the inbox.
- **Sources**: view a source’s collected feed, refresh it, visit its site, or remove it and its collected contents.

The generic `/api/items` and `/api/items/state` endpoints handle library queries and account-scoped state. Importing is dispatched by provider in `src/lib/sources.ts`; additional providers can use the existing sources/items schema without changing inbox behavior. Only video/YouTube importing is exposed for now. State writes use a deterministic per-user/item primary key in the existing `item_states` table, so this change requires no new migration.

## YouTube experience

Search by channel name, @handle, or channel URL. Search waits 400 ms after typing and cancels outdated requests. Selecting a result imports the channel’s available RSS videos into the inbox. The library loads 36 items at a time without a 100-item cutoff. It preserves the history collected since subscription; YouTube RSS does not provide the channel’s entire historical catalog.

Optionally configure `YOUTUBE_API_KEY` with YouTube Data API v3 enabled for channel name search. Without it, the app reads public YouTube search results; YouTube can block these requests or change the page format. If search is unavailable, the dialog suggests a direct handle or channel URL.

Videos play in a YouTube privacy-enhanced embed after a click. Videos whose owners disable embedding can be opened with the YouTube link below the player.

## Automatic YouTube refresh

Vercel calls `/api/cron/sync` once per day at 08:00 UTC. Add a `CRON_SECRET` environment variable in Vercel (a different random value from `AUTH_SECRET`). Vercel sends this secret automatically to the Cron route.
