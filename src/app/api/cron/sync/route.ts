import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { syncYouTubeSource } from "@/lib/feed";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  if (!db) return new NextResponse("Database not connected", { status: 503 });
  const allSources = await db.select({ id: sources.id, feedUrl: sources.feedUrl }).from(sources).where(eq(sources.active, true));
  const results = await Promise.allSettled(allSources.map(syncYouTubeSource));
  return NextResponse.json({ synced: results.filter(result => result.status === "fulfilled").length, imported: results.reduce((total, result) => total + (result.status === "fulfilled" ? result.value : 0), 0) });
}
