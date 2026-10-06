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

Sources can be edited from their management screen. Empty title/site/image fields resolve from the provider when saving; explicit values are kept. Link changes are inspected before persistence. Editing never imports or deletes items and preserves saved/read/progress states.

Podcasts resume like videos, with 90% completion, and only begin recording after playback starts. Starting a previously seen podcast or interacting with a previously read article marks it new for that session; explicit manual-new actions suppress automatic completion until the panel is reopened. Article scroll progress is account-scoped, represented as a percentage in the existing progress fields (`progress_seconds` 0–100, `duration_seconds` 100 for articles; media retains seconds). Opening alone never changes state or erases a saved position. Full articles become read at 90% after at least 10 seconds of attentive reading; summary-only feeds require an explicit read action. Reader font/size/width choices are per device, and fullscreen reading supports keyboard focus and Escape.

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

Article cards show publisher artwork, a clean excerpt, author, publication date, read/unread state and an in-app “Lire l’article” action. On narrow screens articles span the grid width. Images load lazily without a referrer; missing/broken images fall back to the source initial and domain. Opening an article does not automatically mark it read; the explicit action says “Marquer comme lu”. Reading estimates appear only for at least 200 words of available feed text and are labelled as estimates based on that text, which may be shorter than the full article.

RSS/Atom artwork is extracted from Media RSS thumbnails/content/groups, image enclosures, iTunes artwork, direct image fields, or the first useful inline image. Relative and lazy/responsive images are supported; tiny tracking pixels, non-image media and unsafe URL schemes are excluded. Feed artwork is the final item fallback and is saved as the source avatar for newly added RSS sources. Image attachments do not misclassify articles as podcasts. Atom publication timestamps take precedence over modification timestamps.

Publisher HTML stays inert in storage. The items API produces decoded plain-text excerpts (up to 320 characters) and strips script/style/template content. Legacy HTML summaries are also cleaned immediately; legacy image values incorrectly pointing at the feed itself are ignored so embedded artwork can be recovered. Synchronizing existing feed entries refreshes their persisted metadata. RSS synchronization does not scrape article pages or proxy images; feeds without artwork use the visual fallback.

## YouTube experience

Search by channel name, @handle, or channel URL. Search runs only on Enter or the Rechercher button, cancels outdated requests, and reuses matching YouTube responses for up to one hour. Direct channel links and @handles avoid search.list calls. Results support multi-selection across successive searches, then `/api/sources/batch` validates, inserts and synchronizes up to 50 channels with partial-failure reporting. From that point onward Shelf keeps everything it collects, deduplicated by `(sourceId, guid)`. A new source imports one page of recent videos. Later API syncs follow additional pages only until encountering the first source-owned, already-known video (or reaching the end), so more than 50 publications between syncs are not silently missed. Known videos in the boundary page are included for metadata refresh; unknown videos older than the boundary are not imported.

Configure the server-only `YOUTUBE_API_KEY` with YouTube Data API v3 enabled for channel search and synchronization. With a key, sync reconstructs the videos-only playlist (`UULF` + channel ID suffix) directly and calls `playlistItems.list` with up to 50 entries per page. There is no `channels.list`, `search.list`, or per-video detail call during synchronization. New candidates are checked against the Shorts playlist (`UUSH`) before insertion, including Shorts with ordinary `/watch` links. That check pages only while publication dates can overlap the new candidates, shares the same cache, and is skipped for metadata-only syncs. Each list request costs one quota unit. Successful pages are cached five minutes and concurrent duplicate requests share one in-flight request on a warm instance. Cached pages are rechecked against the current source's stored GUIDs; cached results do not determine when another account stops pagination. Lists are fetched fresh when the local cache expires. Cold instances and extra catch-up pages can add requests, so these are reuse policies rather than a strict daily quota ceiling. Memory cache identifiers contain resource parameters or an `api`/`no-api` scope, never the API credential.

Publication dates come from `contentDetails.videoPublishedAt`, not the playlist insertion timestamp. Encountered items refresh their title, image, author, description, duration and publication date. Sparse backup values preserve existing non-empty metadata. Item IDs, creation timestamps, seen/saved/read-later state and playback progress remain unchanged. Only newly inserted items count as imports. Shorts are excluded using YouTube’s format-specific generated playlists: `UULF` for videos, `UUSH` for Shorts. These prefixes are undocumented upstream behavior; when backups are eligible, RSS results are intersected with the verified `/videos` page. If that page cannot be verified, the source fails rather than importing unclassified RSS entries. A missing RSS feed can still use the verified page directly; the mixed uploads feed is never used. No duration heuristics or per-video classification requests are used. The videos-only policy also omits live-stream uploads.

In Sources, “Retirer les Shorts importés” deletes confirmed Shorts, including old `/watch` URLs. The authenticated cleanup reads one page of 50 Shorts per owned YouTube source with three workers, then deletes matching library IDs (plus explicit `/shorts` URLs). “Continuer le nettoyage” follows returned cursors in subsequent user-triggered batches until complete. API failures leave unverified videos untouched and return retry cursors; cleanup requires the server API key and does not happen automatically during sync.

On API failure for a new or empty source, sync tries RSS; on RSS 404 it can use the verified public channel video page as a last resort. For an existing library using API catch-up, an API failure is reported instead of converting a truncated RSS/page backup into success. This preserves the known-video boundary for a later API retry. Without a key, sync starts with RSS. Successful RSS/page backups are cached for five minutes on a warm instance and concurrent duplicate requests share one fetch. Page-derived videos have no exact publication date and are sorted after dated items. API quota/key failures trigger a fifteen-minute cooldown; server errors/network failures/timeouts trigger a one-minute cooldown. These pauses are shared by sources on the current warm instance, avoiding repeated rejected API requests within a batch. The cooldown is not a distributed lock across Vercel instances. HTTP/timeouts remain distinguishable and logs contain only safe categories, hostname, status and duration; API keys and response bodies are never logged.

Without a key, search reads public YouTube search results; YouTube can block these requests or change the page format. If search is unavailable, the dialog suggests a direct handle or channel URL.

Videos play in a YouTube privacy-enhanced embed after a click. Videos whose owners disable embedding can be opened with the YouTube link below the player.

## Automatic source refresh

Vercel calls `/api/cron/sync` once per day at 08:00 UTC. Add a `CRON_SECRET` environment variable in Vercel (a different random value from `AUTH_SECRET`). Vercel sends this secret automatically to the Cron route.

Cron handles all active providers with at most three source syncs running simultaneously. It skips sources successfully synchronized within the past hour and returns `{ synced, failed, imported, skipped, remaining }`. Both cron and global manual refresh prioritize never-synced sources, then the least recently successful ones, with a stable ID tie-breaker. Manual refresh stops starting work after 220 seconds; cron stops after 180 seconds to reserve time for email delivery. Both give each started source a 60-second cooperative deadline, leaving time before Vercel’s 300-second limit for in-flight requests, persistence and response serialization. Deferred/unstarted source IDs are returned in `remaining`; they do not update `lastSyncedAt`, so the next cron/manual pass retries them ahead of recently completed sources. Fetches retain their own ten-second timeouts; database stalls are not forcibly cancelled by this cooperative budget. Failures remain isolated. The manual global refresh sends one authenticated server request, includes every active provider, and reloads feed/source state once after completion. Manual refresh can reuse the five-minute YouTube API cache even when cron would skip the source.


## Daily email digest

After scheduled source workers finish, cron sends at most one digest per account with that run’s newly inserted videos, articles and podcasts. No new inserts means no email. Items are grouped by source, with title, type, available publication date and a direct link; the email displays up to 20 items and links to Shelf’s Nouveautés. It uses the existing `RESEND_API_KEY`, verified `EMAIL_FROM` and `APP_URL` configuration. Manual refresh never sends a digest.

The preference is enabled by default, including existing accounts without a preference row. Users can disable or re-enable it under account settings → Emails → Digest quotidien. Disabled users are also excluded when retrying queued messages.

**Before deploying this feature, apply the committed migration with `npm run db:migrate` against the deployment database.** Migration `0012` adds preferences, durable cron runs, source checkpoints, exact insertion attribution and the email outbox; it leaves existing authentication columns unchanged. Do not run production cron against an unmigrated database.

Cron returns `{ runId, synced, failed, imported, skipped, remaining, emailsSent, emailsFailed, emailsDeferred }`. `emailsSent` means Resend accepted the request, not confirmed inbox delivery. Logs contain only user ID, item count, success, provider HTTP status and a fixed error category.

Insertion and cron attribution happen in one SQL statement. Conflict metadata updates preserve item state and never enter the import ledger. Each UTC day has one durable logical run (`daily-YYYY-MM-DD`); overlapping requests cannot acquire its lease. A retry before synchronization completes resumes pending source checkpoints; a retry after sealing only attempts unsent email deliveries using the stored summary. Deferred sources wait for the next day’s run (or manual refresh). Calls after a completed run on the same UTC day do not start another source pass.

Before contacting Resend, the exact message and first-attempt timestamp are persisted. Retries reuse the same message and Resend idempotency key, including when acceptance succeeded but the database acknowledgement failed. Resend retains idempotency keys for 24 hours: uncertain messages older than 23 hours are deliberately abandoned rather than risking a duplicate. Retries of failed deliveries require another cron request within that window; the next day’s run does not replay yesterday’s outbox. Delivery is paced below two requests per second and stops before the 300-second execution limit, retaining unsent messages for a retry. Per-user failures do not interrupt other deliveries or fail successful source synchronization.

Tests use an isolated PostgreSQL-compatible PGlite database and mocked Resend responses; they never send real emails or modify the deployed database.


## In-app RSS reader and podcast player

Article cards open the existing reading panel. The authenticated `/api/items/[id]/content` endpoint checks source ownership and sanitizes stored publisher HTML with a strict `sanitize-html` allowlist. It preserves paragraphs, headings, lists, links, blockquotes, images and basic tables while removing scripts, arbitrary embeds, forms, unsafe URLs, event handlers, styles and identifiable tracking pixels. Relative URLs resolve against the article URL; images are lazy and send no referrer. Opening an article never changes its read state. Save/read buttons and the original source link remain available in the panel.

RSS `content:encoded` and Atom `content` are retained separately in `items.content_html`. Full content is preferred; description/summary-only and legacy entries show an excerpt notice and the source link. Missing/failed content leaves a clear external fallback. The reader fetches only stored Shelf content, never scrapes the publisher’s article page. Apply migration `0013` with `npm run db:migrate` before deployment; synchronize existing RSS sources to populate full content. Existing metadata/state/deduplication behavior is preserved.

Podcast cards open native HTML audio controls using the captured `audioUrl`. Playback resumes after metadata loads, saves progress through the existing ownership-checked progress endpoint, flushes on pause/seek/close/page exit, and uses the same 90% seen / 95% resume-reset rules as YouTube. A manual mark-as-new suppresses automatic completion during that opening. Browser playback errors and missing/unsafe audio URLs show an external source fallback. Native controls expose play/pause, seeking, elapsed time and duration. YouTube continues to use its existing player unchanged.

Feed inspection parses XML structure after a successful fetch regardless of MIME type, including generic XML or plain text. RSS 2.0, RSS 1.0/RDF and Atom (including namespace-prefixed Atom) are supported. Malformed XML, non-feed XML, HTTP failure, network failure and timeout remain distinct. Existing HTTP(S)-only/no-credentials URL validation and ten-second request/body timeout remain; RSS response bodies are capped at 5 MiB. External entity/DOCTYPE documents are rejected. No MIME-only rejection is used.


## Library and source improvements

The latest automatic cron run is visible above the library. Its source/import/email
counts are scoped to the signed-in account; manual refresh does not affect this
status or send a digest. Source health distinguishes never synced, OK, temporary
unavailability, and persistent errors (at least three failures spanning three days).
Pausing/resuming sources is explicit; paused sources are skipped by automatic/global sync.

Categories can be selected or created when adding RSS/YouTube sources, and applied
to multiple selected sources in Sources. The library combines category, source,
content type, read/in-progress and saved-only filters. Search covers title, source,
author, feed content and cached extracted article content. These filters also apply
to “mark all current results as seen”. Account settings export grouped OPML sources
or saved content as JSON/CSV.

RSS reader formatting retains safe tables/captions, nested lists, code, quotations,
definition lists and lazy images. For excerpts, “Récupérer l’article complet” makes
one explicit request with a public-IP-pinned transport and Readability extraction,
then stores sanitized content. Extraction is never automatic on sync/open: a fresh
cache lasts 24 hours, concurrent requests share a lease, failed attempts wait ten
minutes, and each user is limited to five requests/minute and thirty/day. Unavailable
articles retain their source link. Saved/read/playback state is independent of this cache.

**Deployment:** apply `npm run db:migrate` using the production database's
`DATABASE_URL` before deploying this change. Migration 0014 adds source failure
tracking, durable cron source ownership and `article_documents`. If deployments use separate Neon branches, apply
the migration to each database that will run this version. The migration does not
alter existing source IDs, subscriptions or item states.

See [the targeted security review](docs/security-audit.md) for implemented fixes,
checks and remaining limits. API mutation clients must send a same-origin Origin
header; browser requests do this automatically. The authenticated cron GET is unchanged.
