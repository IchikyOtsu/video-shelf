import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { articleDocuments, items, sources } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { uuidPattern } from "@/lib/library";
import { readerContent } from "@/lib/reader-content";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchArticle } from "@/lib/article-extract";
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user)
    return Response.json({ error: "Connexion requise." }, { status: 401 });
  if (!db)
    return Response.json({ error: "Lecture indisponible." }, { status: 503 });
  const { id } = await params;
  if (!uuidPattern.test(id))
    return Response.json({ error: "Article introuvable." }, { status: 404 });
  const headers = { "Cache-Control": "private, no-store" };
  let claimed = false;
  try {
    const [item] = await db
      .select({
        url: items.url,
        summary: items.summary,
        contentHtml: items.contentHtml,
      })
      .from(items)
      .innerJoin(sources, eq(items.sourceId, sources.id))
      .where(
        and(
          eq(items.id, id),
          eq(items.mediaType, "article"),
          eq(sources.userId, user.id),
        ),
      )
      .limit(1);
    if (!item)
      return Response.json({ error: "Article introuvable." }, { status: 404 });
    const fromFeed = readerContent(item);
    if (fromFeed.kind === "full") return Response.json(fromFeed, { headers });
    const cached = await db.query.articleDocuments.findFirst({
      where: eq(articleDocuments.itemId, id),
    });
    if (
      cached?.html &&
      cached.fetchedAt &&
      Date.now() - cached.fetchedAt.getTime() < 86_400_000
    )
      return Response.json(
        readerContent({ ...item, contentHtml: cached.html }),
        { headers },
      );
    if (
      (await checkRateLimit("article-extract", user.id, 5, 60_000)) ||
      (await checkRateLimit("article-extract-daily", user.id, 30, 86_400_000))
    )
      return Response.json(
        {
          error:
            "Limite de récupération atteinte. Ouvre le site de la source ou réessaie plus tard.",
        },
        { status: 429 },
      );
    const lease = await db.execute(
      sql`insert into article_documents (item_id,lease_until) values (${id}::uuid,now() + interval '30 seconds') on conflict (item_id) do update set lease_until = excluded.lease_until where (article_documents.lease_until is null or article_documents.lease_until <= now()) and (article_documents.retry_after is null or article_documents.retry_after <= now()) returning item_id`,
    );
    if (!lease.rows.length)
      return Response.json(
        {
          error:
            "Récupération en cours ou temporairement indisponible. Réessaie plus tard.",
        },
        { status: 429 },
      );
    claimed = true;
    const html = await fetchArticle(item.url);
    await db
      .update(articleDocuments)
      .set({ html, fetchedAt: new Date(), leaseUntil: null, retryAfter: null })
      .where(eq(articleDocuments.itemId, id));
    return Response.json({ html, kind: "full" }, { headers });
  } catch {
    if (claimed) {
      try {
        await db
          .update(articleDocuments)
          .set({
            leaseUntil: null,
            retryAfter: new Date(Date.now() + 10 * 60_000),
          })
          .where(eq(articleDocuments.itemId, id));
      } catch {
        /* No feed body, URL or database error is logged. */
      }
    }
    return Response.json(
      {
        error:
          "Le contenu complet n’est pas disponible. Tu peux lire sur le site de la source.",
      },
      { status: 502 },
    );
  }
}
