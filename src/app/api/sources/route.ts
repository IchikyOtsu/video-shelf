import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";

async function currentUser() { return readSession((await cookies()).get(cookieName)?.value); }

export async function GET() {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ sources: await db.select().from(sources).where(eq(sources.userId, user.id)).orderBy(asc(sources.name)) });
}

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name, feedUrl, category, kind } = await request.json();
  try { new URL(feedUrl); } catch { return NextResponse.json({ error: "Ajoute une URL valide." }, { status: 400 }); }
  if (!name?.trim()) return NextResponse.json({ error: "Ajoute un nom pour cette source." }, { status: 400 });
  const [source] = await db.insert(sources).values({ userId: user.id, name: name.trim(), feedUrl: feedUrl.trim(), category: category || "Non classé", kind: kind || "rss" }).returning();
  return NextResponse.json({ source }, { status: 201 });
}
