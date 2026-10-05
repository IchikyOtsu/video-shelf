import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { syncSource } from "@/lib/sources";
import { syncSourceBatch } from "@/lib/source-sync-batch";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  if (!db) return new NextResponse("Database not connected", { status: 503 });
  const allSources = await db.select({ id: sources.id, feedUrl: sources.feedUrl, kind: sources.kind }).from(sources).where(eq(sources.active, true));
  return NextResponse.json(await syncSourceBatch(allSources, syncSource));
}
