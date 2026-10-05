import { sql } from "drizzle-orm";
import { db } from "@/db";
import { tokenHash } from "@/lib/security";
export function rateLimitStatement(key:string, windowMs:number) {
  return sql`insert into auth_rate_limits (key, count, window_started_at)
    values (${key}, 1, now()) on conflict (key) do update set
    count = case when auth_rate_limits.window_started_at <= now() - ${windowMs} * interval '1 millisecond' then 1 else auth_rate_limits.count + 1 end,
    window_started_at = case when auth_rate_limits.window_started_at <= now() - ${windowMs} * interval '1 millisecond' then now() else auth_rate_limits.window_started_at end
    returning count`;
}
export async function checkRateLimit(action: string, identifier: string, limit = 5, windowMs = 15 * 60_000) {
  if (!db) return false;
  const key = tokenHash(`${action}:${identifier}`);
  const result = await db.execute<{ count:number }>(rateLimitStatement(key,windowMs));
  return result.rows[0].count > limit;
}
export const requestIdentity = (request: Request, email = "") => `${email.toLowerCase()}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`;
