# Shelf

A personal feed aggregator with a unified inbox, a permanent collected library, saved items, seen items, and source management. Video feeds are the first supported format, with YouTube as the first provider; the data and UI contracts also cover articles and podcasts for future providers.

## Product model

> The Inbox contains unprocessed new items. Seen items disappear from the Inbox but remain permanently available in the Library and under their Source.

- **Nouveautés** contains only items that have not been marked as seen.
- **Enregistrés** is independent from seen state: a saved item stays saved before and after it is seen.
- **Bibliothèque** contains every item Shelf has collected.
- **Vues** contains processed items without treating them as a separate archive to manage.
- Opening a **Source** always starts on its complete collected history. The source status filter can narrow that history to new or seen items.

Opening a video resumes its account-scoped position from Neon. Shelf samples active playback locally and persists integer-second progress about every 10 seconds, plus pause/close lifecycle saves. A video becomes seen after 90% of actual playback or when YouTube reports that it ended; manual seen/new actions remain authoritative and never erase progress.

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
- **Sources**: search collapsible video/article/podcast groups, view a source’s collected feed, refresh it, visit its site, or remove it and its collected contents.

The independent `type=all|video|article|podcast` query filter can be combined with every library view, source, search and sort. Item state writes update the visible list and counts optimistically; normal seen/saved actions do not reload the source collection.

Pagination currently remains offset-based. Local removals adjust the next offset so ordinary Inbox actions do not skip the next row, but concurrent inserts from a source sync can still move page boundaries; a future cursor based on `(publishedAt, itemId)` is the intended follow-up if feeds become high-volume.

The generic `/api/items` and `/api/items/state` endpoints handle library queries and account-scoped state. The bulk state endpoint reuses the same server-side filters, including user ownership, source, search, media type, and view. State writes use a deterministic per-user/item primary key in `item_states`; updating `read` never changes `saved`.

Importing is dispatched by the small provider contract in `src/lib/sources.ts`. A provider fetches and returns normalized items; the generic sync layer deduplicates and persists them, then records `lastSyncedAt` or a short `lastSyncError` on the source. This keeps library and item-state behavior independent from providers and leaves a contained path for future article or podcast feeds.

## Articles and RSS artwork

Article cards show publisher artwork, a clean excerpt, author, publication date, read/unread state and a direct “Lire l’article” link. On narrow screens articles span the grid width. Images load lazily without a referrer; missing/broken images fall back to the source initial and domain. Opening an article does not automatically mark it read; the explicit action says “Marquer comme lu”. Reading estimates appear only for at least 200 words of available feed text and are labelled as estimates based on that text, which may be shorter than the full article.

RSS/Atom artwork is extracted from Media RSS thumbnails/content/groups, image enclosures, iTunes artwork, direct image fields, or the first useful inline image. Relative and lazy/responsive images are supported; tiny tracking pixels, non-image media and unsafe URL schemes are excluded. Feed artwork is the final item fallback and is saved as the source avatar for newly added RSS sources. Image attachments do not misclassify articles as podcasts. Atom publication timestamps take precedence over modification timestamps.

Publisher HTML stays inert in storage. The items API produces decoded plain-text excerpts (up to 320 characters) and strips script/style/template content. Legacy HTML summaries are also cleaned immediately; legacy image values incorrectly pointing at the feed itself are ignored so embedded artwork can be recovered. Synchronizing existing feed entries refreshes their persisted metadata. No article page scraping, image proxy requests, or database migration is required; feeds without artwork use the visual fallback.

## YouTube experience

Search by channel name, @handle, or channel URL. Search waits 400 ms after typing and cancels outdated requests. Results support multi-selection across successive searches, then `/api/sources/batch` validates, inserts and synchronizes up to 50 channels with partial-failure reporting. From that point onward Shelf keeps everything it collects, deduplicated by `(sourceId, guid)`. A new source imports one page of recent videos. Later API syncs follow additional pages only until encountering the first source-owned, already-known video (or reaching the end), so more than 50 publications between syncs are not silently missed. Known videos in the boundary page are included for metadata refresh; unknown videos older than the boundary are not imported.

Configure the server-only `YOUTUBE_API_KEY` with YouTube Data API v3 enabled for channel search and synchronization. With a key, sync reconstructs the videos-only playlist (`UULF` + channel ID suffix) directly and calls `playlistItems.list` with up to 50 entries per page. There is no `channels.list`, `search.list`, or per-video detail call during synchronization. Each list request costs one quota unit. Successful pages are cached five minutes and concurrent duplicate requests share one in-flight request on a warm instance. Cached pages are rechecked against the current source's stored GUIDs; cached results do not determine when another account stops pagination. Lists are fetched fresh when the local cache expires. Cold instances and extra catch-up pages can add requests, so these are reuse policies rather than a strict daily quota ceiling. Memory cache identifiers contain resource parameters or an `api`/`no-api` scope, never the API credential.

Publication dates come from `contentDetails.videoPublishedAt`, not the playlist insertion timestamp. Encountered items refresh their title, image, author, description, duration and publication date. Sparse backup values preserve existing non-empty metadata. Item IDs, creation timestamps, seen/saved/read-later state and playback progress remain unchanged. Only newly inserted items count as imports. Shorts are excluded using YouTube’s format-specific generated playlists: `UULF` for videos, `UUSH` for Shorts. These prefixes are undocumented upstream behavior; when backups are eligible, they use its RSS feed and then the verified `/videos` page, never the mixed uploads feed. No duration heuristics or per-video classification requests are used. The videos-only policy also omits live-stream uploads.

In Sources, “Retirer les Shorts importés” deletes confirmed Shorts, including old `/watch` URLs. The authenticated cleanup reads one page of 50 Shorts per owned YouTube source with three workers, then deletes matching library IDs (plus explicit `/shorts` URLs). “Continuer le nettoyage” follows returned cursors in subsequent user-triggered batches until complete. API failures leave unverified videos untouched and return retry cursors; cleanup requires the server API key and does not happen automatically during sync.

On API failure for a new or empty source, sync tries RSS; on RSS 404 it can use the verified public channel video page as a last resort. For an existing library using API catch-up, an API failure is reported instead of converting a truncated RSS/page backup into success. This preserves the known-video boundary for a later API retry. Without a key, sync starts with RSS. Successful RSS/page backups are cached for five minutes on a warm instance and concurrent duplicate requests share one fetch. Page-derived videos have no exact publication date and are sorted after dated items. API quota/key failures trigger a fifteen-minute cooldown; server errors/network failures/timeouts trigger a one-minute cooldown. These pauses are shared by sources on the current warm instance, avoiding repeated rejected API requests within a batch. The cooldown is not a distributed lock across Vercel instances. HTTP/timeouts remain distinguishable and logs contain only safe categories, hostname, status and duration; API keys and response bodies are never logged.

Without a key, search reads public YouTube search results; YouTube can block these requests or change the page format. If search is unavailable, the dialog suggests a direct handle or channel URL.

Videos play in a YouTube privacy-enhanced embed after a click. Videos whose owners disable embedding can be opened with the YouTube link below the player.

## Automatic source refresh

Vercel calls `/api/cron/sync` once per day at 08:00 UTC. Add a `CRON_SECRET` environment variable in Vercel (a different random value from `AUTH_SECRET`). Vercel sends this secret automatically to the Cron route.

Cron handles all active providers with at most three source syncs running simultaneously. It skips sources successfully synchronized within the past hour and returns `{ synced, failed, imported, skipped, remaining }`. Both cron and global manual refresh prioritize never-synced sources, then the least recently successful ones, with a stable ID tie-breaker. They stop starting work after 220 seconds and give each started source a 60-second cooperative deadline, leaving time before Vercel’s 300-second limit for in-flight requests, persistence and response serialization. Deferred/unstarted source IDs are returned in `remaining`; they do not update `lastSyncedAt`, so the next cron/manual pass retries them ahead of recently completed sources. Fetches retain their own ten-second timeouts; database stalls are not forcibly cancelled by this cooperative budget. Failures remain isolated. The manual global refresh sends one authenticated server request, includes every active provider, and reloads feed/source state once after completion. Manual refresh can reuse the five-minute YouTube API cache even when cron would skip the source.
