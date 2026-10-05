import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { itemDateOrder } from "@/lib/item-query";
export async function GET() { if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 }); const user = await readSession((await cookies()).get(cookieName)?.value); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const videos = await db.select({ id: items.id, title: items.title, url: items.url, imageUrl: items.imageUrl, publishedAt: items.publishedAt, sourceName: sources.name, sourceId: sources.id }).from(items).innerJoin(sources, eq(items.sourceId, sources.id)).where(eq(sources.userId, user.id)).orderBy(itemDateOrder("newest"), asc(items.id)).limit(100); return NextResponse.json({ videos }); }
