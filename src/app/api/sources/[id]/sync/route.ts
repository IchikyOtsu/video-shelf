import { checkRateLimit } from "@/lib/rate-limit";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { syncSource } from "@/lib/sources";
import { uuidPattern } from "@/lib/library";
import { syncSourceBatch } from "@/lib/source-sync-batch";

export const maxDuration = 300;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (await checkRateLimit("source-sync",user.id,30,60 * 60_000)) return NextResponse.json({ error:"Trop de requêtes. Réessaie plus tard." },{ status:429 });
  const { id } = await params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Source invalide." }, { status: 400 });
  const source = await db.query.sources.findFirst({ where: and(eq(sources.id, id), eq(sources.userId, user.id)) });
  if (!source) return NextResponse.json({ error: "Source introuvable." }, { status: 404 });
  return NextResponse.json(await syncSourceBatch([source], syncSource));
}
