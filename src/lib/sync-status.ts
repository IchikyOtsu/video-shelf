import { sql } from "drizzle-orm";
import type { DigestQuery } from "./cron-digest-store";
export type AutomaticSyncStatus = {
  id: string;
  startedAt: string;
  phase: string;
  running: boolean;
  synced: number;
  failed: number;
  imported: number;
  pending: number;
  emailsSent: number;
  emailsFailed: number;
};
export async function automaticSyncStatus(query: DigestQuery, userId: string) {
  const rows = await query<AutomaticSyncStatus & Record<string, unknown>>(sql`
    select r.id, r.created_at as "startedAt", r.phase, coalesce(r.lease_token is not null and r.lease_until > now(),false) as running,
      (select count(*)::int from cron_run_sources c left join sources s on s.id = c.source_id where c.run_id = r.id and (c.user_id = ${userId}::uuid or c.user_id is null and s.user_id = ${userId}::uuid) and c.status = 'synced') as synced,
      (select count(*)::int from cron_run_sources c left join sources s on s.id = c.source_id where c.run_id = r.id and (c.user_id = ${userId}::uuid or c.user_id is null and s.user_id = ${userId}::uuid) and c.status = 'failed') as failed,
      (select count(*)::int from cron_run_sources c left join sources s on s.id = c.source_id where c.run_id = r.id and (c.user_id = ${userId}::uuid or c.user_id is null and s.user_id = ${userId}::uuid) and c.status = 'pending') as pending,
      (select count(*)::int from cron_run_items i where i.run_id = r.id and i.user_id = ${userId}::uuid) as imported,
      (select count(*)::int from cron_digests d where d.run_id = r.id and d.user_id = ${userId}::uuid and d.status = 'sent') as "emailsSent",
      (select count(*)::int from cron_digests d where d.run_id = r.id and d.user_id = ${userId}::uuid and d.status in ('failed','abandoned')) as "emailsFailed"
    from cron_runs r order by r.created_at desc, r.id desc limit 1`);
  return rows[0] || null;
}
