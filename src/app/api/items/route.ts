import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, itemStates, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { parseLibraryQuery } from "@/lib/library";

export async function GET(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connecte-toi pour retrouver tes flux." }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Bibliothèque temporairement indisponible." }, { status: 503 });
  let filters;
  try { filters = parseLibraryQuery(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ error: "Filtres invalides." }, { status: 400 }); }
  const { view, sourceId, offset, query, sort, mediaType } = filters;
  const read = sql<boolean>`coalesce(${itemStates.read}, false)`;
  const saved = sql<boolean>`coalesce(${itemStates.saved}, false)`;
  const ownership = and(eq(sources.userId, user.id), eq(items.mediaType, mediaType));
  const stateJoin = and(eq(itemStates.itemId, items.id), eq(itemStates.userId, user.id));
  const term = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
  const condition = and(ownership, sourceId ? eq(sources.id, sourceId) : undefined,
    view === "inbox" ? eq(read, false) : view === "archive" ? eq(read, true) : view === "saved" ? eq(saved, true) : undefined,
    query ? or(ilike(items.title, term), ilike(sources.name, term)) : undefined);
  try {
    const [rows, [total], [counts]] = await Promise.all([
      db.select({ id: items.id, title: items.title, url: items.url, imageUrl: items.imageUrl, publishedAt: items.publishedAt, sourceName: sources.name, sourceId: sources.id, sourceKind: sources.kind, mediaType: items.mediaType, read, saved })
        .from(items).innerJoin(sources, eq(items.sourceId, sources.id)).leftJoin(itemStates, stateJoin).where(condition)
        .orderBy(sort === "oldest" ? asc(sql`coalesce(${items.publishedAt}, ${items.createdAt})`) : desc(sql`coalesce(${items.publishedAt}, ${items.createdAt})`), asc(items.id)).limit(36).offset(offset),
      db.select({ value: sql<number>`count(*)::int` }).from(items).innerJoin(sources, eq(items.sourceId, sources.id)).leftJoin(itemStates, stateJoin).where(condition),
      db.select({
        all: sql<number>`count(*)::int`,
        inbox: sql<number>`count(*) filter (where not ${read})::int`,
        archive: sql<number>`count(*) filter (where ${read})::int`,
        saved: sql<number>`count(*) filter (where ${saved})::int`,
      }).from(items).innerJoin(sources, eq(items.sourceId, sources.id)).leftJoin(itemStates, stateJoin).where(ownership),
    ]);
    return NextResponse.json({ items: rows, total: total.value, nextOffset: offset + rows.length < total.value ? offset + rows.length : null, counts });
  } catch {
    return NextResponse.json({ error: "Impossible de charger les flux. Réessaie." }, { status: 503 });
  }
}
