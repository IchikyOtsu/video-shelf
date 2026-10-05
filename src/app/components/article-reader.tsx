"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import type { FeedItem } from "@/lib/library";
import type { ReaderContent } from "@/lib/reader-content";
import { request } from "@/lib/client";
import { safeMediaUrl } from "@/lib/item-opening";

export function ArticleReader({ item }: { item: FeedItem }) {
  const [content, setContent] = useState<ReaderContent | null>(null);
  const [failed, setFailed] = useState(false);
  const [failedImage, setFailedImage] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request(`/api/items/${item.id}/content`, { signal: controller.signal }).then((data: ReaderContent) => {
      if (!controller.signal.aborted) setContent(data);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [item.id]);
  const parsedDate = item.publishedAt ? new Date(item.publishedAt) : null;
  const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? new Intl.DateTimeFormat("fr-BE", { dateStyle: "long" }).format(parsedDate) : "";
  const image = safeMediaUrl(item.imageUrl);
  return <article className="article-reader">
    <header><p className="eyebrow">{item.sourceName}</p><h2>{item.title}</h2><p className="reader-byline">{item.author && <span>{item.author}</span>}{date && <time dateTime={item.publishedAt!}>{date}</time>}</p></header>
    {image && !failedImage && <img className="reader-cover" src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(true)} />}
    {!content && !failed ? <p role="status">Chargement de l’article…</p> : null}
    {failed || content?.kind === "missing" ? <p className="reader-notice">Le flux ne fournit pas de contenu lisible. Ouvre l’article sur le site de la source.</p> : null}
    {content?.kind === "summary" && <p className="reader-notice">Le flux fournit uniquement un extrait. Lis la suite sur le site de la source.</p>}
    {/* Only the authenticated content endpoint's server-sanitized HTML enters the DOM. */}
    {content?.html && <div className="reader-prose" dangerouslySetInnerHTML={{ __html: content.html }} />}
  </article>;
}
