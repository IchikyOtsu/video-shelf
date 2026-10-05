import { and, asc, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { items, itemStates, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { itemRead, itemSaved, itemStateJoin } from "@/lib/item-query";
import { exportCsv, exportOpml } from "@/lib/user-export";
import { checkRateLimit } from "@/lib/rate-limit";
export async function GET(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user)
    return Response.json({ error: "Connexion requise." }, { status: 401 });
  if (!db)
    return Response.json({ error: "Export indisponible." }, { status: 503 });
  const format = new URL(request.url).searchParams.get("format");
  if (!["opml", "json", "csv"].includes(format || ""))
    return Response.json({ error: "Format invalide." }, { status: 400 });
  if (await checkRateLimit("user-export", user.id, 10, 60_000))
    return Response.json(
      { error: "Réessaie dans une minute." },
      { status: 429 },
    );
  try {
    let body: string;
    let type: string;
    if (format === "opml") {
      const rows = await db
        .select()
        .from(sources)
        .where(eq(sources.userId, user.id))
        .orderBy(asc(sources.category), asc(sources.name));
      body = exportOpml(rows);
      type = "text/x-opml";
    } else {
      const rows = await db
        .select({
          title: items.title,
          url: items.url,
          sourceName: sources.name,
          category: sources.category,
          mediaType: items.mediaType,
          author: items.author,
          publishedAt: items.publishedAt,
          read: itemRead,
          progressSeconds: sql<number>`coalesce(${itemStates.progressSeconds},0)`,
          durationSeconds: itemStates.durationSeconds,
        })
        .from(items)
        .innerJoin(sources, eq(items.sourceId, sources.id))
        .leftJoin(itemStates, itemStateJoin(user.id))
        .where(and(eq(sources.userId, user.id), eq(itemSaved, true)))
        .orderBy(asc(sources.name), asc(items.id));
      body =
        format === "json"
          ? JSON.stringify(
              { version: 1, exportedAt: new Date().toISOString(), items: rows },
              null,
              2,
            )
          : exportCsv(rows);
      type = format === "json" ? "application/json" : "text/csv";
    }
    return new Response(body, {
      headers: {
        "Content-Type": type + "; charset=utf-8",
        "Content-Disposition": `attachment; filename="shelf-${format === "opml" ? "sources" : "saved"}.${format}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Export indisponible." }, { status: 503 });
  }
}
