import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, itemStates, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { parseStateChange } from "@/lib/library";

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
    // A stable primary key makes simultaneous first-time saves idempotent without
    // changing the existing schema. States are always scoped to the signed-in user.
    const rows = ids.map(itemId => ({
      id: createHash("sha256").update(user.id + ":" + itemId).digest("hex").slice(0, 32),
      userId: user.id, itemId, ...fields, updatedAt: new Date(),
    }));
    await db.insert(itemStates).values(rows).onConflictDoUpdate({ target: itemStates.id, set: { ...fields, updatedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "La modification n’a pas été enregistrée. Réessaie." }, { status: 503 });
  }
}
