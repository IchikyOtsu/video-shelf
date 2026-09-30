import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) { if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 }); const user = await readSession((await cookies()).get(cookieName)?.value); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const { id } = await params; const deleted = await db.delete(sources).where(and(eq(sources.id, id), eq(sources.userId, user.id))).returning({ id: sources.id }); if (!deleted.length) return NextResponse.json({ error: "Source introuvable" }, { status: 404 }); return NextResponse.json({ ok: true }); }
