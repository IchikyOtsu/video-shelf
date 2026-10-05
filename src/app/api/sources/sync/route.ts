import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { syncSource } from "@/lib/sources";
import { SYNC_BATCH_START_BUDGET_MS } from "@/lib/sync-control";
import { prioritizeSyncSources } from "@/lib/cron-sync";
import { syncSourceBatch } from "@/lib/source-sync-batch";

export const maxDuration = 300;

export async function POST() {
  const startedAt = Date.now();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const activeSources = await db.select({ id: sources.id, kind: sources.kind, feedUrl: sources.feedUrl, lastSyncedAt: sources.lastSyncedAt })
    .from(sources).where(and(eq(sources.userId, user.id), eq(sources.active, true)));
  return NextResponse.json(await syncSourceBatch(prioritizeSyncSources(activeSources), syncSource, { startBudgetMs: Math.max(0, SYNC_BATCH_START_BUDGET_MS - (Date.now() - startedAt)) }));
}
