import { sql } from "drizzle-orm";
import { metadataUpdateSet } from "./item-sync-update";
import type { NormalizedItem } from "./sources";

export type CronImportContext = { runId: string; leaseToken: string };
export type SourceSyncResult = { imported: number; insertedItemIds: string[] };
export function insertedSyncResult(rows: { id: string; inserted: boolean }[]): SourceSyncResult {
  const insertedItemIds = rows.filter(row => row.inserted).map(row => row.id);
  return { imported: insertedItemIds.length, insertedItemIds };
}

// One database statement: item insert + attribution cannot be separated by a
// function crash. xmax distinguishes INSERT from conflict metadata UPDATE.
export function itemImportStatement(sourceId: string, rows: NormalizedItem[], cron?: CronImportContext, options: { initialImport?: boolean } = {}) {
  const values = sql.join(rows.map(item => sql`(${sourceId}::uuid, ${item.guid}, ${item.title}, ${item.url}, ${item.audioUrl ?? null}, ${item.summary ?? null}, ${item.author ?? null}, ${item.mediaType}, ${item.duration ?? null}, ${item.imageUrl ?? null}, ${item.contentHtml ?? null}, ${item.publishedAt?.toISOString() ?? null}::timestamptz)`), sql`, `);
  const columns = ["title", "image_url", "author", "summary", "duration", "content_html", "published_at"];
  const updates = Object.values(metadataUpdateSet()).map((value, i) => sql`${sql.identifier(columns[i])} = ${value}`);
  const lease = cron ? sql`active_run as (select id from cron_runs where id = ${cron.runId} and phase = 'syncing' and lease_token = ${cron.leaseToken} and lease_until > now() for share),` : sql``;
  const guard = cron ? sql`cross join active_run` : sql``;
  const record = cron ? sql`, recorded as (
    insert into cron_run_items (item_id, run_id, user_id, source_id, source_name, title, url, media_type, published_at)
    select u.id, ${cron.runId}, s.user_id, s.id, s.name, u.title, u.url, u.media_type, u.published_at
    from upserted u join sources s on s.id = ${sourceId}::uuid where u.inserted
    on conflict (item_id) do nothing returning item_id
  )` : sql``;
  const initialStates = options.initialImport ? sql`, initial_states as (
    insert into item_states (id, user_id, item_id, read)
    select substring(encode(sha256(convert_to(s.user_id::text || ':' || u.id::text, 'UTF8')), 'hex'), 1, 32)::uuid,
      s.user_id, u.id, true from upserted u join sources s on s.id = ${sourceId}::uuid
    on conflict (user_id, item_id) do nothing returning id
  )` : sql``;
  return sql`with ${lease} upserted as (
    insert into items (source_id, guid, title, url, audio_url, summary, author, media_type, duration, image_url, content_html, published_at)
    select incoming.* from (values ${values}) as incoming(source_id, guid, title, url, audio_url, summary, author, media_type, duration, image_url, content_html, published_at) ${guard} where true
    on conflict (source_id, guid) do update set ${sql.join(updates, sql`, `)}
    returning id, title, url, media_type, published_at, (xmax = 0) as inserted
  ) ${record} ${initialStates} select id, inserted from upserted`;
}
