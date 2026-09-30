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
  const [selected, setSelected] = useState<ChannelResult | null>(null);
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
    if (!selected || saving) return;
    setSaving(true); setError("");
    try {
      const data = await request("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: selected.name, feedUrl: "https://www.youtube.com/channel/" + selected.channelId, kind: "youtube", category: "Vidéos",
      }) });
      onAdded(selected.name + " ajoutée. " + (data.imported ? data.imported + " vidéos dans ta boîte de réception." : "Aucune vidéo récupérée pour le moment. Tu peux réessayer depuis Sources."));
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }
  return <dialog ref={dialog} className="channel-dialog" aria-labelledby="add-source-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div className="source-form">
      <button className="close" disabled={saving} onClick={onClose} aria-label="Fermer">×</button>
      <span className="eyebrow">UNE NOUVELLE SOURCE</span>
      <h2 id="add-source-title">Qu’aimerais-tu suivre ?</h2>
      <div className="provider-choice"><span>▶</span><div><b>YouTube</b><small>Flux de vidéos · recherche par nom, @handle ou lien</small></div></div>
      <label htmlFor="channel-search">Rechercher une chaîne</label>
      <input id="channel-search" type="search" maxLength={200} value={query} disabled={saving} autoComplete="off" placeholder="Ex. Veritasium, @arte…" onChange={event => { setQuery(event.target.value); setSelected(null); setResults([]); setError(""); setSearched(false); setChecking(event.target.value.trim().length >= 2); }} />
      <div className="search-status" role="status">{checking ? "Recherche sur YouTube…" : error ? error : searched ? results.length + " chaîne(s) trouvée(s)" : "Commence à écrire · résultats en direct"}</div>
      <div className="channel-results" aria-label="Résultats de recherche">{results.map(result => {
        const added = feedUrls.some(url => url.includes(result.channelId));
        return <button key={result.channelId} disabled={saving || added} aria-pressed={selected?.channelId === result.channelId} className={"channel-result " + (selected?.channelId === result.channelId ? "selected" : "")} onClick={() => setSelected(result)}>
          {result.imageUrl ? <img src={result.imageUrl} alt="" /> : <span className="avatar">{result.name[0]?.toUpperCase()}</span>}
          <span><b>{result.name}</b><small>{added ? "Déjà dans tes sources" : result.description || "Chaîne YouTube"}</small></span><span aria-hidden="true">{selected?.channelId === result.channelId || added ? "✓" : "+"}</span>
        </button>;
      })}</div>
      {searched && !results.length && <p>Aucune chaîne trouvée. Essaie un autre nom ou son lien YouTube.</p>}
      <button className="dark-button" disabled={saving || !selected || checking} onClick={add}>{saving ? "Ajout et récupération du flux…" : selected ? "Suivre " + selected.name : "Sélectionne une source"}</button>
      <small className="local-note">Les vidéos disponibles arrivent dans ta boîte. Les prochains contenus s’y ajouteront lors des actualisations.</small>
    </div>
  </dialog>;
}
