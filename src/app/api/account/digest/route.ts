import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { digestPreferences } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { parseDigestPreference } from "@/lib/digest-preference";

export async function POST(request: Request) {
  const session = await readSession((await cookies()).get(cookieName)?.value);
  if (!session || !db) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  let enabled: boolean;
  try { enabled = parseDigestPreference(await request.json()); }
  catch { return NextResponse.json({ error: "Préférence invalide." }, { status: 400 }); }
  try {
    await db.insert(digestPreferences).values({ userId: session.id, enabled }).onConflictDoUpdate({ target: digestPreferences.userId, set: { enabled } });
    return NextResponse.json({ enabled });
  } catch { return NextResponse.json({ error: "Impossible d’enregistrer la préférence. Réessaie." }, { status: 503 }); }
}
