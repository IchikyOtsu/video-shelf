"use client";
/* External channel avatars are returned by YouTube and are not served by Next's optimizer. */
/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from "react";
import { contentTypes, type ContentType } from "@/lib/library";

export type SourceSummary = { id: string; name: string; feedUrl: string; siteUrl: string | null; imageUrl: string | null; kind: string; active: boolean; contentType: Exclude<ContentType, "all">; category: string; lastSyncedAt: string | null; lastSyncError: string | null };

function syncLabel(value: string | null) {
  if (!value) return "Jamais actualisée";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Dernière actualisation inconnue" : "Dernière réussite : " + new Intl.DateTimeFormat("fr-BE", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function SourceBrowser({ sources, loading, refreshing, cleaningShorts, cleanupMore, onAdd, onOpen, onRefresh, onRemove, onRemoveShorts }: {
  sources: SourceSummary[];
  loading: boolean;
  refreshing: boolean;
  cleaningShorts: boolean;
  cleanupMore: boolean;
  onAdd(): void;
  onOpen(source: SourceSummary): void;
  onRefresh(source: SourceSummary): void;
  onRemove(source: SourceSummary): void;
  onRemoveShorts(): void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("fr");
    const filtered = term ? sources.filter(source => source.name.toLocaleLowerCase("fr").includes(term) || source.kind.toLocaleLowerCase("fr").includes(term)) : sources;
    return (["video", "article", "podcast"] as const).map(type => ({ type, sources: filtered.filter(source => source.contentType === type) })).filter(group => group.sources.length);
  }, [query, sources]);
  return <section className="sources-page" aria-label="Gestion des sources">
    <div className="library-toolbar"><div><h2>Les sources suivies</h2><p>{sources.length} source(s)</p></div><div className="source-toolbar-actions">{sources.some(source => source.kind === "youtube") ? <button className="quiet-button" disabled={cleaningShorts} onClick={onRemoveShorts}>{cleaningShorts ? "Nettoyage…" : cleanupMore ? "Continuer le nettoyage" : "Retirer les Shorts importés"}</button> : null}<button className="dark-button" onClick={onAdd}>＋ Ajouter des sources</button></div></div>
    <label className="source-search"><span>⌕</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher une source…" aria-label="Rechercher une source" /></label>
    {loading ? <p role="status" className="list-loading">Chargement des sources…</p> : groups.length ? groups.map(group => {
      const isCollapsed = collapsed.has(group.type);
      return <section className="source-group" key={group.type}><button className="source-group-heading" aria-expanded={!isCollapsed} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(group.type)) next.delete(group.type); else next.add(group.type); return next; })}><span>{contentTypes[group.type].icon} {contentTypes[group.type].label}</span><small>{group.sources.length}</small><span aria-hidden="true">{isCollapsed ? "＋" : "−"}</span></button>{!isCollapsed ? <div className="source-list">{group.sources.map(source => <article className="source-row" key={source.id}>{source.kind === "youtube" && source.imageUrl ? <img className="avatar" src={source.imageUrl} alt="" /> : <span className="avatar">{source.name[0]?.toUpperCase()}</span>}<div className="source-details"><h3>{source.name}</h3><p>{source.kind === "youtube" ? "YouTube" : source.kind} · {contentTypes[source.contentType].label}</p><small className={source.lastSyncError ? "sync-warning" : ""}>{source.lastSyncError ? "⚠ " + source.lastSyncError : syncLabel(source.lastSyncedAt)}</small></div><div className="source-actions"><button className="outline-button" onClick={() => onOpen(source)}>Voir l’historique</button><button className="quiet-button" disabled={refreshing} onClick={() => onRefresh(source)}>Actualiser</button><a href={source.siteUrl || source.feedUrl} target="_blank" rel="noreferrer" aria-label={"Ouvrir " + source.name}>↗</a><button className="remove-source" aria-label={"Supprimer " + source.name} onClick={() => onRemove(source)}>×</button></div></article>)}</div> : null}</section>;
    }) : <div className="dashboard-empty"><span>◉</span><h2>{query ? "Aucune source trouvée" : "Choisis tes premières sources"}</h2><p>{query ? "Essaie un autre nom ou fournisseur." : "Suis une chaîne YouTube pour alimenter tes nouveautés."}</p>{!query ? <button className="dark-button" onClick={onAdd}>Ajouter des sources</button> : null}</div>}
  </section>;
}
