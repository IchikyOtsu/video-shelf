"use client";
/* eslint-disable @next/next/no-img-element */
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
  return <article className={["video-card", active ? "is-playing" : "", selected ? "is-selected" : ""].filter(Boolean).join(" ")}>
    <label className="item-select"><input type="checkbox" checked={selected} onChange={() => onSelect(item)} /><span>Sélectionner</span></label>
    {isVideo ? <button className="video-thumb" onClick={() => onOpen(item)} aria-label={"Regarder " + item.title}>{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : null}<span className="play-icon">▶</span><span className={"watched-badge " + (!item.read ? "unread-badge" : "")}>{item.read ? "✓ Vue" : "• À découvrir"}</span>{item.progressSeconds > 0 && item.durationSeconds ? <span className="playback-progress" aria-label={Math.round(Math.min(item.progressSeconds / item.durationSeconds, 1) * 100) + "% regardé"}><span style={{ width: Math.min(item.progressSeconds / item.durationSeconds, 1) * 100 + "%" }} /></span> : null}</button>
      : <a className="generic-thumb" href={item.url} target="_blank" rel="noreferrer">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span aria-hidden="true">{item.mediaType === "podcast" ? "◉" : "≡"}</span>}<small>{item.mediaType === "podcast" ? "Podcast" : "Article"}</small></a>}
    <div className="video-meta"><button className="source-link" onClick={() => onSource(item.sourceId)}>{item.sourceName}</button><button className="save-video" disabled={changing} aria-label={(item.saved ? "Retirer des enregistrés " : "Enregistrer ") + item.title} aria-pressed={item.saved} onClick={() => onSave(item)}>{item.saved ? "♥" : "♡"}</button></div>
    <h3>{isVideo ? <button onClick={() => onOpen(item)}>{item.title}</button> : <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>}</h3>
    {!isVideo && item.summary ? <p className="item-summary">{item.summary}</p> : null}
    <div className="card-footer"><time dateTime={item.publishedAt || undefined}>{dateLabel(item.publishedAt)}</time><button disabled={changing} onClick={() => onSeen(item)}>{item.read ? "↩ Marquer comme nouveau" : "✓ Marquer comme vu"}</button></div>
  </article>;
}
