import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { uuidPattern } from "@/lib/library";
import { readerContent } from "@/lib/reader-content";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Lecture indisponible." }, { status: 503 });
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Contenu introuvable." }, { status: 404 });
  try {
    const [item] = await db.select({ contentHtml: items.contentHtml, summary: items.summary, url: items.url }).from(items).innerJoin(sources, eq(items.sourceId, sources.id)).where(and(eq(items.id, id), eq(sources.userId, user.id))).limit(1);
    if (!item) return NextResponse.json({ error: "Contenu introuvable." }, { status: 404 });
    return NextResponse.json(readerContent(item), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Lecture indisponible. Ouvre le site de la source." }, { status: 503 }); }
}
