"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { ChannelResult } from "@/lib/youtube";
import { request } from "@/lib/client";

export function AddSource({ feedUrls, onClose, onAdded }: {
  feedUrls: string[]; onClose: () => void; onAdded: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChannelResult[]>([]);
  const [selected, setSelected] = useState<Map<string, ChannelResult>>(new Map());
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await request("/api/youtube/search?q=" + encodeURIComponent(query.trim()), { signal: controller.signal });
        if (!controller.signal.aborted) { setResults(data.channels); setSearched(true); }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      finally { if (!controller.signal.aborted) setChecking(false); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  async function add() {
    if (!selected.size || saving) return;
    setSaving(true); setError("");
    try {
      const data = await request("/api/sources/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources: [...selected.values()].map(source => ({ kind: "youtube", channelId: source.channelId, name: source.name })) }) });
      const addedCount = data.added.length + data.failed.filter((failure: { added?: boolean }) => failure.added).length;
      onAdded(addedCount + " source(s) ajoutée(s) · " + data.imported + " nouveau(x) contenu(s)." + (data.alreadyExisting.length ? " " + data.alreadyExisting.length + " déjà suivie(s)." : "") + (data.failed.length ? " " + data.failed.length + " erreur(s) à vérifier dans Sources." : ""));
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }
  return <dialog ref={dialog} className="channel-dialog" aria-labelledby="add-source-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div className="source-form source-form-batch">
      <button className="close" disabled={saving} onClick={onClose} aria-label="Fermer">×</button>
      <div><span className="eyebrow">AJOUTER DES SOURCES</span><h2 id="add-source-title">Qu’aimerais-tu suivre ?</h2></div>
      <div className="provider-tabs" role="tablist" aria-label="Type de source"><button role="tab" aria-selected="true">▷ Vidéos</button><button role="tab" aria-selected="false" disabled>≡ Articles <small>Bientôt</small></button><button role="tab" aria-selected="false" disabled>◉ Podcasts <small>Bientôt</small></button></div>
      <div className="provider-choice"><span>▶</span><div><b>YouTube</b><small>Recherche et ajoute plusieurs chaînes en une fois</small></div></div>
      <label htmlFor="channel-search">Rechercher des chaînes YouTube</label>
      <input id="channel-search" type="search" maxLength={200} value={query} disabled={saving} autoComplete="off" placeholder="Ex. programmation, @arte…" onChange={event => { setQuery(event.target.value); setResults([]); setError(""); setSearched(false); setChecking(event.target.value.trim().length >= 2); }} />
      <div className="search-status" role="status">{checking ? "Recherche sur YouTube…" : error ? error : searched ? results.length + " chaîne(s) trouvée(s) · " + selected.size + " sélectionnée(s)" : selected.size ? selected.size + " chaîne(s) sélectionnée(s). Continue ta recherche ou ajoute-les." : "Commence à écrire · résultats en direct"}</div>
      <div className="channel-results" aria-label="Résultats de recherche">{results.map(result => {
        const added = feedUrls.some(url => url.includes(result.channelId));
        const checked = selected.has(result.channelId);
        return <label key={result.channelId} className={"channel-result " + (checked ? "selected" : "") + (added ? " already-added" : "")}><input type="checkbox" disabled={saving || added} checked={checked || added} onChange={() => setSelected(previous => { const next = new Map(previous); if (next.has(result.channelId)) next.delete(result.channelId); else next.set(result.channelId, result); return next; })} />
          {result.imageUrl ? <img src={result.imageUrl} alt="" /> : <span className="avatar">{result.name[0]?.toUpperCase()}</span>}
          <span><b>{result.name}</b><small>{added ? "Déjà dans tes sources" : result.description || "Chaîne YouTube"}</small></span>
        </label>;
      })}</div>
      {searched && !results.length ? <p>Aucune chaîne trouvée. Essaie un autre nom ou son lien YouTube.</p> : null}
      <div className="source-dialog-footer"><span>{selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</span><button className="dark-button" disabled={saving || !selected.size} onClick={add}>{saving ? "Ajout et synchronisation…" : "Ajouter " + selected.size + " source" + (selected.size > 1 ? "s" : "")}</button></div>
    </div>
  </dialog>;
}
