"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import type { FeedItem } from "@/lib/library";

function dateLabel(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium" }).format(date) : "";
}

export function ItemCard({ item, selected, active, changing, onSelect, onOpen, onSource, onSave, onSeen }: {
  item: FeedItem;
  selected: boolean;
  active: boolean;
  changing: boolean;
  onSelect(item: FeedItem): void;
  onOpen(item: FeedItem): void;
  onSource(sourceId: string): void;
  onSave(item: FeedItem): void;
  onSeen(item: FeedItem): void;
}) {
  const isVideo = item.mediaType === "video";
  const isArticle = item.mediaType === "article";
  const [failedImage, setFailedImage] = useState<string | null>(null);
  let hostname = "";
  try { hostname = new URL(item.url).hostname.replace(/^www\./, ""); } catch { /* The source name remains available. */ }
  return <article className={["video-card", isArticle ? "article-card" : "", active ? "is-playing" : "", selected ? "is-selected" : ""].filter(Boolean).join(" ")}>
    <label className="item-select"><input type="checkbox" checked={selected} onChange={() => onSelect(item)} /><span>Sélectionner</span></label>
    {isVideo ? <button className="video-thumb" onClick={() => onOpen(item)} aria-label={"Regarder " + item.title}>{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : null}<span className="play-icon">▶</span><span className={"watched-badge " + (!item.read ? "unread-badge" : "")}>{item.read ? "✓ Vue" : "• À découvrir"}</span>{item.progressSeconds > 0 && item.durationSeconds ? <span className="playback-progress" aria-label={Math.round(Math.min(item.progressSeconds / item.durationSeconds, 1) * 100) + "% regardé"}><span style={{ width: Math.min(item.progressSeconds / item.durationSeconds, 1) * 100 + "%" }} /></span> : null}</button>
            : <a className={"generic-thumb " + (isArticle ? "article-thumb" : "")} href={item.url} target="_blank" rel="noreferrer" aria-label={(isArticle ? "Lire " : "Ouvrir ") + item.title + " (nouvel onglet)"}>{item.imageUrl && item.imageUrl !== failedImage ? <img src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" ref={image => { if (image?.complete && image.naturalWidth === 0) setFailedImage(item.imageUrl); }} onError={() => setFailedImage(item.imageUrl)} /> : <span className="article-placeholder" aria-hidden="true"><b>{isArticle ? item.sourceName.slice(0, 1).toLocaleUpperCase("fr") : "◉"}</b>{isArticle ? <span>{hostname || item.sourceName}</span> : null}</span>}<small>{isArticle ? "Article" : "Podcast"}</small>{isArticle ? <span className={"article-state " + (item.read ? "" : "is-unread")}>{item.read ? "✓ Lu" : "• À lire"}</span> : null}</a>}
    <div className="video-meta"><button className="source-link" onClick={() => onSource(item.sourceId)}>{item.sourceName}</button><button className="save-video" disabled={changing} aria-label={(item.saved ? "Retirer des enregistrés " : "Enregistrer ") + item.title} aria-pressed={item.saved} onClick={() => onSave(item)}>{item.saved ? "♥" : "♡"}</button></div>
    <h3>{isVideo ? <button onClick={() => onOpen(item)}>{item.title}</button> : <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>}</h3>
    {!isVideo && (item.author || item.readingMinutes) ? <p className="article-byline">{item.author ? <span>{item.author}</span> : null}{item.readingMinutes ? <span title="Estimation à partir du texte fourni par le flux">≈ {item.readingMinutes} min de lecture</span> : null}</p> : null}
    {!isVideo && item.summary ? <p className="item-summary">{item.summary}</p> : null}
    {isArticle ? <a className="read-article" href={item.url} target="_blank" rel="noreferrer">Lire l’article <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 9 9 3M3 3h6v6" /></svg><span className="sr-only"> (nouvel onglet)</span></a> : null}
    <div className="card-footer"><time dateTime={item.publishedAt || undefined}>{dateLabel(item.publishedAt)}</time><button disabled={changing} onClick={() => onSeen(item)}>{item.read ? "↩ Marquer comme nouveau" : isArticle ? "✓ Marquer comme lu" : "✓ Marquer comme vu"}</button></div>
  </article>;
}
