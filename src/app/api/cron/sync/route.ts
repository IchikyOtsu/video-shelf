import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { syncSource } from "@/lib/sources";
import { SYNC_BATCH_START_BUDGET_MS } from "@/lib/sync-control";
import { syncSourceBatch } from "@/lib/source-sync-batch";
import { cronSyncDue, prioritizeSyncSources } from "@/lib/cron-sync";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  const startedAt = Date.now();
  if (!db) return new NextResponse("Database not connected", { status: 503 });
  const allSources = await db.select({ id: sources.id, feedUrl: sources.feedUrl, kind: sources.kind, lastSyncedAt: sources.lastSyncedAt }).from(sources).where(eq(sources.active, true));
  const now = new Date();
  const dueSources = prioritizeSyncSources(allSources.filter(source => cronSyncDue(source.lastSyncedAt, now)));
  return NextResponse.json({ ...await syncSourceBatch(dueSources, syncSource, { startBudgetMs: Math.max(0, SYNC_BATCH_START_BUDGET_MS - (Date.now() - startedAt)) }), skipped: allSources.length - dueSources.length });
}
