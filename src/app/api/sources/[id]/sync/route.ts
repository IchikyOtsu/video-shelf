import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { syncYouTubeSource } from "@/lib/feed";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) { if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 }); const user = await readSession((await cookies()).get(cookieName)?.value); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const { id } = await params; const source = await db.query.sources.findFirst({ where: and(eq(sources.id, id), eq(sources.userId, user.id)) }); if (!source) return NextResponse.json({ error: "Source introuvable" }, { status: 404 }); return NextResponse.json({ imported: await syncYouTubeSource(source) }); }
