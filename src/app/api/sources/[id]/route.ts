import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { parseSourceEdit, resolveSourceEdit, SourceEditError } from "@/lib/source-edit";
import { inspectRssFeed } from "@/lib/rss";
import { resolveYouTubeChannel } from "@/lib/youtube";
import { uuidPattern } from "@/lib/library";
import { safeSourceSyncError, SourceDatabaseError } from "@/lib/source-database-error";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: "Bibliothèque indisponible." }, { status: 503 });
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const { id } = await params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Source introuvable." }, { status: 404 });
  try {
    const source = await db.query.sources.findFirst({ where: and(eq(sources.id, id), eq(sources.userId, user.id)) });
    if (!source) return NextResponse.json({ error: "Source introuvable." }, { status: 404 });
    const edit = parseSourceEdit(await request.json());
    let resolved;
    try { resolved = await resolveSourceEdit(edit, source, async url => {
      if (source.kind === "youtube") return { ...await resolveYouTubeChannel(url), contentType: "video" };
      if (source.kind === "rss") return inspectRssFeed(url);
      throw new SourceEditError("Ce fournisseur ne permet pas encore la modification des liens.");
    }); } catch (error) {
      return NextResponse.json({ error: error instanceof SourceEditError ? error.message : "Impossible de vérifier ce flux. Vérifie le lien ou réessaie plus tard." }, { status: 400 });
    }
    const duplicate = await db.query.sources.findFirst({ where: and(eq(sources.userId, user.id), eq(sources.feedUrl, resolved.feedUrl)) });
    if (duplicate && duplicate.id !== id) return NextResponse.json({ error: "Cette source est déjà dans ta bibliothèque." }, { status: 409 });
    const [updated] = await db.update(sources).set({ ...resolved, ...(resolved.feedUrl !== source.feedUrl ? { lastSyncError:null } : {}) }).where(and(eq(sources.id, id), eq(sources.userId, user.id), eq(sources.feedUrl, source.feedUrl))).returning();
    if (!updated) return NextResponse.json({ error: "La source a changé. Actualise la page et réessaie." }, { status: 409 });
    return NextResponse.json({ source: updated });
  } catch (error) {
    if (error instanceof SourceEditError || error instanceof SyntaxError) return NextResponse.json({ error: error instanceof SourceEditError ? error.message : "Réglages invalides." }, { status: 400 });
    const safe = safeSourceSyncError(error);
    return NextResponse.json({ error: safe instanceof SourceDatabaseError && safe.databaseCode === "23505" ? "Cette source existe déjà." : "La source n’a pas été modifiée." }, { status: safe instanceof SourceDatabaseError && safe.databaseCode === "23505" ? 409 : 503 });
  }
}
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) { if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 }); const user = await readSession((await cookies()).get(cookieName)?.value); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const { id } = await params; const deleted = await db.delete(sources).where(and(eq(sources.id, id), eq(sources.userId, user.id))).returning({ id: sources.id }); if (!deleted.length) return NextResponse.json({ error: "Source introuvable" }, { status: 404 }); return NextResponse.json({ ok: true }); }
