import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, itemStates, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { deterministicItemStateId } from "@/lib/item-state";
import { processProgressUpdate, ProgressAccessError, ProgressValidationError, type ProgressUpdate } from "@/lib/playback";

async function persistProgress(userId: string, update: ProgressUpdate) {
  if (!db) throw new Error("Database unavailable");
  const observedAt = new Date(update.observedAt);
  await db.insert(itemStates).values({
    id: deterministicItemStateId(userId, update.itemId), userId, itemId: update.itemId,
    progressSeconds: update.progressSeconds, durationSeconds: update.durationSeconds, lastPlayedAt: observedAt, updatedAt: new Date(),
  }).onConflictDoUpdate({ target: itemStates.id, set: {
    progressSeconds: sql`case when ${itemStates.lastPlayedAt} is null or excluded.last_played_at >= ${itemStates.lastPlayedAt} then excluded.progress_seconds else ${itemStates.progressSeconds} end`,
    durationSeconds: sql`case when ${itemStates.lastPlayedAt} is null or excluded.last_played_at >= ${itemStates.lastPlayedAt} then coalesce(excluded.duration_seconds, ${itemStates.durationSeconds}) else ${itemStates.durationSeconds} end`,
    lastPlayedAt: sql`greatest(coalesce(${itemStates.lastPlayedAt}, excluded.last_played_at), excluded.last_played_at)`,
    updatedAt: new Date(),
  } });
}

export async function PATCH(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Bibliothèque indisponible." }, { status: 503 });
  const database = db;
  try {
    const update = await processProgressUpdate(
      await request.json(),
      async itemId => Boolean(await database.select({ id: items.id }).from(items).innerJoin(sources, eq(items.sourceId, sources.id)).where(and(eq(items.id, itemId), eq(sources.userId, user.id))).limit(1).then(rows => rows[0])),
      value => persistProgress(user.id, value),
    );
    return NextResponse.json({ ok: true, progressSeconds: update.progressSeconds, durationSeconds: update.durationSeconds, lastPlayedAt: new Date(update.observedAt).toISOString() });
  } catch (error) {
    if (error instanceof ProgressValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ProgressAccessError) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "La progression n’a pas été enregistrée." }, { status: 503 });
  }
}
