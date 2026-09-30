import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { syncSource } from "@/lib/sources";
import { uuidPattern } from "@/lib/library";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Source invalide." }, { status: 400 });
  const source = await db.query.sources.findFirst({ where: and(eq(sources.id, id), eq(sources.userId, user.id)) });
  if (!source) return NextResponse.json({ error: "Source introuvable." }, { status: 404 });
  try { return NextResponse.json({ imported: await syncSource(source) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Actualisation impossible." }, { status: 502 }); }
}
