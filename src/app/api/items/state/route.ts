import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, itemStates, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { buildItemCondition, itemStateJoin } from "@/lib/item-query";
import { parseLibraryQuery, parseStateChange } from "@/lib/library";

async function upsertState(userId: string, ids: string[], fields: { read?: boolean; saved?: boolean }) {
  if (!db) throw new Error("Database not connected");
  for (let start = 0; start < ids.length; start += 500) {
    const rows = ids.slice(start, start + 500).map(itemId => ({
      id: createHash("sha256").update(userId + ":" + itemId).digest("hex").slice(0, 32),
      userId, itemId, ...fields, updatedAt: new Date(),
    }));
    await db.insert(itemStates).values(rows).onConflictDoUpdate({ target: itemStates.id, set: { ...fields, updatedAt: new Date() } });
  }
}

export async function PATCH(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Bibliothèque indisponible." }, { status: 503 });
  let change;
  try { change = parseStateChange(await request.json()); }
  catch { return NextResponse.json({ error: "Modification invalide." }, { status: 400 }); }
  try {
    const owned = await db.select({ id: items.id }).from(items).innerJoin(sources, eq(items.sourceId, sources.id)).where(and(eq(sources.userId, user.id), inArray(items.id, change.ids)));
    if (owned.length !== change.ids.length) return NextResponse.json({ error: "Contenu introuvable." }, { status: 404 });
    const { ids, ...fields } = change;
    await upsertState(user.id, ids, fields);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "La modification n’a pas été enregistrée. Réessaie." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Bibliothèque indisponible." }, { status: 503 });
  let filters;
  try { filters = parseLibraryQuery(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ error: "Filtres invalides." }, { status: 400 }); }
  try {
    const rows = await db.select({ id: items.id })
      .from(items)
      .innerJoin(sources, eq(items.sourceId, sources.id))
      .leftJoin(itemStates, itemStateJoin(user.id))
      .where(buildItemCondition(filters, user.id));
    await upsertState(user.id, rows.map(row => row.id), { read: true });
    return NextResponse.json({ affected: rows.length });
  } catch {
    return NextResponse.json({ error: "Les contenus n’ont pas pu être marqués comme vus." }, { status: 503 });
  }
}
