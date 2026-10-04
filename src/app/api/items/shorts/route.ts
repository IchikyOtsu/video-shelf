import { and, eq, ilike, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";

export async function DELETE() {
  if (!db) return NextResponse.json({ error: "Bibliothèque indisponible." }, { status: 503 });
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  try {
    const youtubeSources = db.select({ id: sources.id }).from(sources).where(and(eq(sources.userId, user.id), eq(sources.kind, "youtube")));
    const removed = await db.delete(items).where(and(inArray(items.sourceId, youtubeSources), ilike(items.url, "%youtube.com/shorts/%"))).returning({ id: items.id });
    return NextResponse.json({ removed: removed.length });
  } catch {
    return NextResponse.json({ error: "Impossible de retirer les Shorts. Réessaie." }, { status: 503 });
  }
}
