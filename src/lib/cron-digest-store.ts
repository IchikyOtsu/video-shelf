import { sql, type SQL } from "drizzle-orm";
import type { SourceSyncInput } from "./sources";
import type { SyncSummary } from "./source-sync-batch";
import type { Digest, DigestDeliveryStore, DigestMessage } from "./daily-digest";

export type CronSummary = SyncSummary & { skipped: number };
export type CronRun = { id: string; phase: string; summary: CronSummary };
export type DigestQuery = <T extends Record<string, unknown>>(statement: SQL) => Promise<T[]>;
export function createCronDigestStore(query: DigestQuery) {
  const lease = (runId: string, token: string) => sql`id = ${runId} and lease_token = ${token} and lease_until > now()`;
  return {
    async acquire(runId: string, token: string): Promise<CronRun | null> {
      const rows = await query<{ id: string; phase: string; summary: CronSummary }>(sql`
        insert into cron_runs (id, lease_token, lease_until) values (${runId}, ${token}, now() + interval '310 seconds')
        on conflict (id) do update set lease_token = excluded.lease_token, lease_until = excluded.lease_until
        where cron_runs.lease_token is null or cron_runs.lease_until <= now()
        returning id, phase, summary`);
      return rows[0] || null;
    },
    async seed(runId: string, token: string) {
      await query(sql`with active as (select id from cron_runs where ${lease(runId, token)} and phase = 'syncing' and not initialized for update),
        queued as (insert into cron_run_sources (run_id, source_id, user_id)
          select active.id, sources.id, sources.user_id from sources cross join active where sources.active and (sources.last_synced_at is null or sources.last_synced_at <= now() - interval '1 hour')
          on conflict do nothing returning source_id)
        update cron_runs set initialized = true, summary = jsonb_build_object('skipped',
          (select count(*) from sources where sources.active) - (select count(*) from queued)) where id in (select id from active) returning id`);
    },
    async pendingSources(runId: string): Promise<(SourceSyncInput & { lastSyncedAt: Date | null })[]> {
      await query(sql`update cron_run_sources c set status = 'skipped' where c.run_id = ${runId} and c.status = 'pending' and not exists (select 1 from sources s where s.id = c.source_id and s.active)`);
      const rows = await query<{ id: string; userId: string; kind: string; feedUrl: string; lastSyncedAt: string | null }>(sql`
        select s.id, s.user_id as "userId", s.kind, s.feed_url as "feedUrl", s.last_synced_at as "lastSyncedAt"
        from cron_run_sources c join sources s on s.id = c.source_id where c.run_id = ${runId} and c.status = 'pending'`);
      return rows.map(source => ({ ...source, lastSyncedAt: source.lastSyncedAt ? new Date(source.lastSyncedAt) : null }));
    },
    async recordSource(runId: string, token: string, sourceId: string, status: "synced" | "failed") {
      const rows = await query(sql`update cron_run_sources set status = ${status} where run_id = ${runId} and source_id = ${sourceId}::uuid
        and exists (select 1 from cron_runs where ${lease(runId, token)} and phase = 'syncing') returning source_id`);
      if (!rows.length) throw new Error("CRON_LEASE_LOST");
    },
    async seal(runId: string, token: string): Promise<CronSummary> {
      // Snapshot at most 20 items plus the full count per user and freeze the run
      // before any email. A shared run lock serializes this with item imports.
      const rows = await query<{ summary: CronSummary }>(sql`with active as (
          select id from cron_runs where ${lease(runId, token)} and phase = 'syncing' for update
        ), ranked as (
          select i.*, row_number() over (partition by user_id order by source_name, source_id, created_at, item_id) as position,
            count(*) over (partition by user_id) as total
          from cron_run_items i where i.run_id in (select id from active)
        ), captured as (
          insert into cron_digests (run_id, user_id, recipient, item_count, payload)
          select ${runId}, r.user_id, u.email, max(r.total)::int,
            jsonb_agg(jsonb_build_object('id', r.item_id, 'sourceId', r.source_id, 'sourceName', r.source_name,
              'title', r.title, 'url', r.url, 'mediaType', r.media_type, 'publishedAt', r.published_at) order by r.position)
          from ranked r join users u on u.id = r.user_id left join digest_preferences p on p.user_id = u.id
          where r.position <= 20 and coalesce(p.enabled, true)
          group by r.user_id, u.email on conflict (run_id, user_id) do nothing returning user_id
        ) update cron_runs set phase = 'ready', summary = summary || jsonb_build_object(
          'synced', (select count(*) from cron_run_sources where run_id = ${runId} and status = 'synced'),
          'failed', (select count(*) from cron_run_sources where run_id = ${runId} and status = 'failed'),
          'imported', (select count(*) from cron_run_items where run_id = ${runId}),
          'skipped', coalesce((summary->>'skipped')::int, 0) + (select count(*) from cron_run_sources where run_id = ${runId} and status = 'skipped'),
          'remaining', coalesce((select jsonb_agg(source_id order by source_id) from cron_run_sources where run_id = ${runId} and status = 'pending'), '[]'::jsonb)
        ) where id in (select id from active) returning summary`);
      if (!rows[0]) throw new Error("CRON_LEASE_LOST");
      return rows[0].summary;
    },
    async pendingDigests(runId: string): Promise<Digest[]> {
      // An opt-out also cancels a previously queued, unsent digest.
      await query(sql`update cron_digests d set status = 'suppressed' where d.run_id = ${runId} and d.status in ('pending','failed','sending')
        and exists (select 1 from digest_preferences p where p.user_id = d.user_id and not p.enabled)`);
      return query<Digest & Record<string, unknown>>(sql`select run_id as "runId", user_id as "userId", recipient,
        item_count as "itemCount", payload, message, first_attempt_at as "firstAttemptAt" from cron_digests
        where run_id = ${runId} and status in ('pending','failed','sending') order by user_id`);
    },
    async claimDigest(digest: Digest, token: string, message: DigestMessage): Promise<Digest | null> {
      const rows = await query<Digest & Record<string, unknown>>(sql`update cron_digests d set status = 'sending', lease_token = ${token},
        lease_until = now() + interval '30 seconds', first_attempt_at = coalesce(first_attempt_at, now()), message = coalesce(message, ${JSON.stringify(message)}::jsonb)
        where d.run_id = ${digest.runId} and d.user_id = ${digest.userId}::uuid and d.status in ('pending','failed','sending')
          and (d.lease_until is null or d.lease_until <= now())
          and (d.first_attempt_at is null or d.first_attempt_at > now() - interval '23 hours')
          and not exists (select 1 from digest_preferences p where p.user_id = d.user_id and not p.enabled)
        returning run_id as "runId", user_id as "userId", recipient, item_count as "itemCount", payload, message, first_attempt_at as "firstAttemptAt"`);
      return rows[0] || null;
    },
    async finishDigest(digest: Digest, token: string, status: "sent" | "failed" | "abandoned", providerStatus: number | null, category: string | null) {
      const rows = await query(sql`update cron_digests set status = ${status}, lease_token = null, lease_until = null,
        sent_at = case when ${status} = 'sent' then now() else sent_at end, provider_status = ${providerStatus}, error_category = ${category}
        where run_id = ${digest.runId} and user_id = ${digest.userId}::uuid
          and (${status} = 'abandoned' and first_attempt_at <= now() - interval '23 hours' or lease_token = ${token}) returning user_id`);
      if (!rows.length) throw new Error("DIGEST_LEASE_LOST");
    },
    async release(runId: string, token: string) {
      await query(sql`update cron_runs set lease_token = null, lease_until = null,
        phase = case when phase = 'ready' and not exists (select 1 from cron_digests where run_id = ${runId} and status in ('pending','failed','sending')) then 'complete' else phase end
        where id = ${runId} and lease_token = ${token} returning id`);
    },
  } satisfies DigestDeliveryStore & Record<string, unknown>;
}
export type CronDigestStore = ReturnType<typeof createCronDigestStore>;
