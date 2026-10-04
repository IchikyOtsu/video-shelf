import { eq } from "drizzle-orm";
import { db } from "@/db";
import { authRateLimits } from "@/db/schema";
import { tokenHash } from "@/lib/security";
export async function checkRateLimit(action: string, identifier: string, limit = 5, windowMs = 15 * 60_000) {
  if (!db) return false;
  const key = tokenHash(`${action}:${identifier}`); const now = new Date(); const row = await db.query.authRateLimits.findFirst({ where: eq(authRateLimits.key, key) });
  if (!row || now.getTime() - row.windowStartedAt.getTime() >= windowMs) { await db.insert(authRateLimits).values({ key, count: 1, windowStartedAt: now }).onConflictDoUpdate({ target: authRateLimits.key, set: { count: 1, windowStartedAt: now } }); return false; }
  if (row.count >= limit) return true;
  await db.update(authRateLimits).set({ count: row.count + 1 }).where(eq(authRateLimits.key, key)); return false;
}
export const requestIdentity = (request: Request, email = "") => `${email.toLowerCase()}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`;
