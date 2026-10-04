# Shelf

A personal feed aggregator with a temporary inbox, a permanent collected library, saved items, seen items, and source management. Video feeds are the first supported format, with YouTube as the first provider.

## Product model

> The Inbox contains unprocessed new items. Seen items disappear from the Inbox but remain permanently available in the Library and under their Source.

- **Nouveautés** contains only items that have not been marked as seen.
- **Enregistrés** is independent from seen state: a saved item stays saved before and after it is seen.
- **Bibliothèque** contains every item Shelf has collected.
- **Vues** contains processed items without treating them as a separate archive to manage.
- Opening a **Source** always starts on its complete collected history. The source status filter can narrow that history to new or seen items.

Opening a video does not immediately change its state. Shelf marks it as seen after the player has stayed open for 30 seconds; the user can also mark it as seen or new manually. Both visible-page and server-side full-filter bulk actions are available from Nouveautés.

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

Authentication uses secure HTTP-only session cookies and password hashes. Sources, collected items, and saved/seen states are stored per account in Postgres. The previous browser-only saved/viewed choices are transferred on sign-in when available.

## Aggregator workflow

- **Nouveautés**: collected videos that have not been seen yet.
- **Bibliothèque**: all collected videos, including seen and saved ones. Search, source filters, oldest/newest sorting, and pagination work across the complete collection.
- **Enregistrés**: saved items, independent of whether they have been seen.
- **Vues**: processed items. Mark an item as new to put it back in Nouveautés.
- **Sources**: view a source’s collected feed, refresh it, visit its site, or remove it and its collected contents.

The generic `/api/items` and `/api/items/state` endpoints handle library queries and account-scoped state. The bulk state endpoint reuses the same server-side filters, including user ownership, source, search, media type, and view. State writes use a deterministic per-user/item primary key in `item_states`; updating `read` never changes `saved`.

Importing is dispatched by the small provider contract in `src/lib/sources.ts`. A provider fetches and returns normalized items; the generic sync layer deduplicates and persists them, then records `lastSyncedAt` or a short `lastSyncError` on the source. This keeps library and item-state behavior independent from providers and leaves a contained path for future article or podcast feeds.

## YouTube experience

Search by channel name, @handle, or channel URL. Search waits 400 ms after typing and cancels outdated requests. Selecting a result imports the channel’s currently available RSS videos into Nouveautés. From that point onward Shelf keeps everything it collects, deduplicated by `(sourceId, guid)`. YouTube RSS does not provide the channel’s entire historical catalog, so Shelf deliberately follows forward instead of crawling older uploads through the Data API.

Optionally configure `YOUTUBE_API_KEY` with YouTube Data API v3 enabled for channel name search. Without it, the app reads public YouTube search results; YouTube can block these requests or change the page format. If search is unavailable, the dialog suggests a direct handle or channel URL.

Videos play in a YouTube privacy-enhanced embed after a click. Videos whose owners disable embedding can be opened with the YouTube link below the player.

## Automatic YouTube refresh

Vercel calls `/api/cron/sync` once per day at 08:00 UTC. Add a `CRON_SECRET` environment variable in Vercel (a different random value from `AUTH_SECRET`). Vercel sends this secret automatically to the Cron route.
