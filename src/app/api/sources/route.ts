import { and, asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { resolveYouTubeChannel } from "@/lib/youtube";
import { inspectRssFeed } from "@/lib/rss";
import { getSourceProvider, syncSource } from "@/lib/sources";

async function currentUser() { return readSession((await cookies()).get(cookieName)?.value); }

export async function GET() {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ sources: await db.select().from(sources).where(eq(sources.userId, user.id)).orderBy(asc(sources.name)) });
}

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name, feedUrl: inputUrl, category, kind } = await request.json();
  let feedUrl = inputUrl?.trim(); let siteUrl: string | null = null; let imageUrl: string | null = null; let resolvedName: string | null = null; let contentType;
  try {
    if (kind === "youtube") { const resolved = await resolveYouTubeChannel(inputUrl); feedUrl = resolved.feedUrl; siteUrl = resolved.siteUrl; imageUrl = resolved.imageUrl; resolvedName = resolved.name; }
    else { const inspected = await inspectRssFeed(feedUrl); resolvedName = inspected.name; siteUrl = inspected.siteUrl; contentType = inspected.contentType; }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Ajoute une URL valide." }, { status: 400 }); }
  if (!name?.trim() && !resolvedName) return NextResponse.json({ error: "Ajoute un nom pour cette source." }, { status: 400 });
  if (await db.query.sources.findFirst({ where: and(eq(sources.userId, user.id), eq(sources.feedUrl, feedUrl)) })) return NextResponse.json({ error: "Cette source est déjà dans ta bibliothèque." }, { status: 409 });
  const provider = getSourceProvider(kind || "rss");
  if (!provider) return NextResponse.json({ error: "Ce type de source n’est pas encore pris en charge." }, { status: 400 });
  const [source] = await db.insert(sources).values({ userId: user.id, name: name?.trim() || resolvedName!, feedUrl, siteUrl, imageUrl, category: category || "Non classé", kind: kind || "rss", contentType: contentType || provider.contentType }).returning();
  let imported = 0;
  try { imported = await syncSource(source, { initialImport: true }); } catch { /* syncSource records the failure; the source remains available for retry. */ }
  return NextResponse.json({ source, imported }, { status: 201 });
}
