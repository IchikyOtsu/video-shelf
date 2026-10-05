import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { youtubeApiClient } from "@/lib/youtube-api";
import { youtubeFeedChannelId } from "@/lib/youtube-fallback";
import { confirmedShortItemIds } from "@/lib/youtube-shorts";
import { syncSourceBatch } from "@/lib/source-sync-batch";
import { logSourceSyncFailure, SourceFetchError } from "@/lib/source-fetch";

export const maxDuration = 300;

export async function DELETE(request: Request) {
  if (!db) return NextResponse.json({ error: "Bibliothèque indisponible." }, { status: 503 });
  const database = db;
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  let cursors: Record<string, string> = {};
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json();
      if (!body || typeof body.cursors !== "object" || !body.cursors || Array.isArray(body.cursors) || Object.entries(body.cursors).some(([id, token]) => id.length > 100 || typeof token !== "string" || token.length > 2048)) throw new Error();
      cursors = body.cursors;
    }
  } catch { return NextResponse.json({ error: "Paramètres de nettoyage invalides." }, { status: 400 }); }
  try {
    // Both selection and deletion stay scoped to the signed-in owner's sources.
    const owned = await database.select({ id: sources.id, kind: sources.kind, feedUrl: sources.feedUrl }).from(sources).where(and(eq(sources.userId, user.id), eq(sources.kind, "youtube")));
    const continuing = Object.keys(cursors).length > 0;
    const selected = continuing ? owned.filter(source => Object.hasOwn(cursors, source.id)) : owned;
    const nextCursors: Record<string, string> = {};
    let removed = 0;
    const summary = await syncSourceBatch(selected, async source => {
      const start = Date.now();
      try {
        const rows = await database.select({ id: items.id, url: items.url }).from(items).where(eq(items.sourceId, source.id));
        if (!rows.length) return 0;
        let ids: string[] = [];
        let lookupError: unknown;
        try {
          const channel = youtubeFeedChannelId(source.feedUrl);
          if (!channel || !process.env.YOUTUBE_API_KEY) throw new SourceFetchError("API_CONFIGURATION", "www.googleapis.com");
          const page = await youtubeApiClient(process.env.YOUTUBE_API_KEY).shorts(channel, cursors[source.id]);
          ids = page.ids;
          if (page.nextPageToken) nextCursors[source.id] = page.nextPageToken;
        } catch (error) { lookupError = error; nextCursors[source.id] = cursors[source.id] || ""; }
        const targets = confirmedShortItemIds(rows, ids);
        // Explicit /shorts URLs can also be removed when the API is unavailable.
        if (targets.length) {
          const deleted = await database.delete(items).where(and(eq(items.sourceId, source.id), inArray(items.id, targets))).returning({ id: items.id });
          removed += deleted.length;
        }
        if (lookupError) throw lookupError;
        return 0;
      } catch (error) {
        nextCursors[source.id] = cursors[source.id] || "";
        logSourceSyncFailure(source, error, Date.now() - start);
        throw error;
      }
    });
    return NextResponse.json({ removed, failed: summary.failed, cursors: nextCursors });
  } catch {
    return NextResponse.json({ error: "Impossible de retirer les Shorts. Réessaie." }, { status: 503 });
  }
}
