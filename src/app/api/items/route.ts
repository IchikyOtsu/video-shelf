import { asc, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, itemStates, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { buildItemCondition, itemDateOrder, itemRead, itemSaved, itemStateJoin } from "@/lib/item-query";
import { articleContent, articlePreview } from "@/lib/article-content";
import { parseLibraryQuery } from "@/lib/library";

export async function GET(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connecte-toi pour retrouver tes flux." }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Bibliothèque temporairement indisponible." }, { status: 503 });
  let filters;
  try { filters = parseLibraryQuery(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ error: "Filtres invalides." }, { status: 400 }); }
  const { view, sourceId, offset, query, sort, contentType } = filters;
  const itemFilters = { view, sourceId, query, contentType };
  const condition = buildItemCondition(itemFilters, user.id);
  const stateJoin = itemStateJoin(user.id);
  try {
    const [rows, [total], [counts]] = await Promise.all([
      db.select({ id: items.id, title: items.title, url: items.url, audioUrl: items.audioUrl, summary: items.summary, author: items.author, imageUrl: items.imageUrl, publishedAt: items.publishedAt, sourceName: sources.name, sourceId: sources.id, sourceKind: sources.kind, sourceFeedUrl: sources.feedUrl, mediaType: items.mediaType, read: itemRead, saved: itemSaved, progressSeconds: sql<number>`coalesce(${itemStates.progressSeconds}, 0)::int`, durationSeconds: itemStates.durationSeconds, lastPlayedAt: itemStates.lastPlayedAt })
        .from(items).innerJoin(sources, eq(items.sourceId, sources.id)).leftJoin(itemStates, stateJoin).where(condition)
        .orderBy(itemDateOrder(sort), asc(items.id)).limit(36).offset(offset),
      db.select({ value: sql<number>`count(*)::int` }).from(items).innerJoin(sources, eq(items.sourceId, sources.id)).leftJoin(itemStates, stateJoin).where(condition),
      db.select({
        all: sql<number>`count(*)::int`,
        inbox: sql<number>`count(*) filter (where not ${itemRead})::int`,
        archive: sql<number>`count(*) filter (where ${itemRead})::int`,
        saved: sql<number>`count(*) filter (where ${itemSaved})::int`,
      }).from(items).innerJoin(sources, eq(items.sourceId, sources.id)).leftJoin(itemStates, stateJoin).where(buildItemCondition({ ...itemFilters, view: "all", sourceId: "", query: "" }, user.id)),
    ]);
    const previews = rows.map(({ sourceFeedUrl, ...item }) => {
      if (item.mediaType === "video") return item;
      const preview = articlePreview(item.summary, item.url, item.imageUrl, sourceFeedUrl);
      return { ...item, ...preview, readingMinutes: item.mediaType === "article" ? preview.readingMinutes : null,
        author: item.author ? articleContent(item.author, item.url).text : null };
    });
    return NextResponse.json({ items: previews, total: total.value, nextOffset: offset + rows.length < total.value ? offset + rows.length : null, counts });
  } catch {
    return NextResponse.json({ error: "Impossible de charger les flux. Réessaie." }, { status: 503 });
  }
}
