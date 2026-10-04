import { and, inArray, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { parseYouTubeBatch, syncBatchSources } from "@/lib/source-batch";
import { syncSource } from "@/lib/sources";

export async function POST(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Base de données indisponible." }, { status: 503 });
  let parsed;
  try { parsed = parseYouTubeBatch(await request.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sélection invalide." }, { status: 400 }); }
  const { candidates, failed: validationFailures } = parsed;
  if (!candidates.length) return NextResponse.json({ added: [], alreadyExisting: [], failed: validationFailures, imported: 0 });
  try {
    const feedUrls = candidates.map(source => source.feedUrl);
    const existing = await db.select({ feedUrl: sources.feedUrl, name: sources.name }).from(sources).where(and(eq(sources.userId, user.id), inArray(sources.feedUrl, feedUrls)));
    const existingFeeds = new Set(existing.map(source => source.feedUrl));
    const fresh = candidates.filter(source => !existingFeeds.has(source.feedUrl));
    const inserted = fresh.length ? await db.insert(sources).values(fresh.map(source => ({ userId: user.id, name: source.name, feedUrl: source.feedUrl, siteUrl: source.siteUrl, imageUrl: source.imageUrl, kind: source.kind, contentType: source.contentType, category: "Non classé" }))).onConflictDoNothing().returning() : [];
    const insertedFeeds = new Set(inserted.map(source => source.feedUrl));
    const alreadyExisting = candidates.filter(source => existingFeeds.has(source.feedUrl) || !insertedFeeds.has(source.feedUrl)).map(source => ({ channelId: source.channelId, name: source.name }));
    const synced = await syncBatchSources(inserted, source => syncSource(source, { initialImport: true }));
    return NextResponse.json({ added: synced.added, alreadyExisting, failed: [...validationFailures, ...synced.failed], imported: synced.imported }, { status: inserted.length ? 201 : 200 });
  } catch {
    return NextResponse.json({ error: "Les sources n’ont pas pu être ajoutées." }, { status: 503 });
  }
}
