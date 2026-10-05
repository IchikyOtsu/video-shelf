import type { SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { syncSourceDetailed } from "@/lib/sources";
import { createCronDigestStore, type DigestQuery } from "@/lib/cron-digest-store";
import { deliverDigests } from "@/lib/daily-digest";
import { digestEmailConfig, sendDigestEmail } from "@/lib/mail";
import { runScheduledSync } from "@/lib/scheduled-sync";

export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  const startedAt = Date.now();
  if (!db) return new NextResponse("Database not connected", { status: 503 });
  const database = db;
  const query: DigestQuery = async <T extends Record<string, unknown>>(statement: SQL) => (await database.execute<T>(statement)).rows;
  const store = createCronDigestStore(query);
  try {
    const result = await runScheduledSync(store, { startedAt, token: randomUUID(), sync: syncSourceDetailed,
      deliver: (runId, deadlineMs) => deliverDigests(runId, store, { deadlineMs, token: randomUUID, config: digestEmailConfig, send: sendDigestEmail }),
    });
    return NextResponse.json(result, { status: result.busy ? 202 : 200 });
  } catch {
    console.error("Scheduled sync failed", { error: "CRON_STORE_ERROR" });
    return NextResponse.json({ error: "Actualisation quotidienne indisponible. Réessaie." }, { status: 503 });
  }
}
