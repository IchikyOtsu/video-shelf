"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { youtubeVideoId } from "@/lib/video";
import type { ChannelResult } from "@/lib/youtube";

type User = { id: string; email: string; name: string | null };
type Source = { id: string; name: string; feedUrl: string; siteUrl: string | null };
type Video = { id: string; title: string; url: string; imageUrl: string | null; publishedAt: string | null; sourceName: string; sourceId: string };
type Library = { saved: string[]; watched: string[] };
type View = "all" | "saved" | "watched";
const emptyLibrary: Library = { saved: [], watched: [] };
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Impossible de charger les données. Réessaie.");
  return data;
}
function dateLabel(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium" }).format(date) : "";
}
export default function Home() {
  const [user, setUser] = useState<User | null>();
  const [sources, setSources] = useState<Source[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [channel, setChannel] = useState("");
  const [results, setResults] = useState<ChannelResult[]>([]);
  const [selected, setSelected] = useState<ChannelResult | null>(null);
  const [searchError, setSearchError] = useState("");
  const [checking, setChecking] = useState(false);
  const [searched, setSearched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<View>("all");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const [playing, setPlaying] = useState<Video | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<HTMLElement>(null);
  async function load() {
    const [s, v] = await Promise.all([request("/api/sources"), request("/api/videos")]);
    setSources(s.sources); setVideos(v.videos);
  }
  useEffect(() => {
    request("/api/auth/me").then(async ({ user: account }) => {
      setUser(account || null);
      if (account) {
        try {
          const stored = JSON.parse(localStorage.getItem("shelf:" + account.id) || "null");
          if (stored && Array.isArray(stored.saved) && Array.isArray(stored.watched)) setLibrary(stored);
        } catch { /* Browser storage may be unavailable. */ }
        try { await load(); } catch (e) { setError((e as Error).message); }
      }
    }).catch(() => { setUser(null); setError("Connexion au serveur impossible. Recharge la page pour réessayer."); });
  }, []);
  useEffect(() => {
    if (!open || channel.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await request("/api/youtube/search?q=" + encodeURIComponent(channel.trim()), { signal: controller.signal });
        if (!controller.signal.aborted) { setResults(data.channels); setSearched(true); }
      } catch (e) {
        if (!controller.signal.aborted) setSearchError((e as Error).message);
      } finally { if (!controller.signal.aborted) setChecking(false); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [channel, open]);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      dialog.current?.querySelector<HTMLInputElement>("#channel-search")?.focus();
    }
    else dialog.current?.close();
  }, [open]);
  function updateLibrary(next: Library) {
    setLibrary(next);
    try { localStorage.setItem("shelf:" + user?.id, JSON.stringify(next)); }
    catch { setNotice("Stockage indisponible : tes choix sont conservés pour cette session."); }
  }
  function toggleSaved(id: string) {
    updateLibrary({ ...library, saved: library.saved.includes(id) ? library.saved.filter(item => item !== id) : [...library.saved, id] });
  }
  function play(video: Video) {
    setPlaying(video);
    requestAnimationFrame(() => { player.current?.scrollIntoView({ behavior: "smooth", block: "start" }); player.current?.focus({ preventScroll: true }); });
  }
  function openSearch() {
    setChannel(""); setResults([]); setSelected(null); setSearchError(""); setSearched(false); setChecking(false); setOpen(true);
  }
  async function addChannel() {
    if (!selected || saving) return;
    setSaving(true); setSearchError("");
    try {
      const data = await request("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selected.name, feedUrl: "https://www.youtube.com/channel/" + selected.channelId, kind: "youtube", category: "Vidéos" }) });
      setOpen(false); setSourceId(""); setView("all"); setQuery("");
      setNotice(data.imported ? selected.name + " ajoutée · " + data.imported + " vidéos récupérées." : selected.name + " ajoutée. Aucune vidéo récupérée : utilise Actualiser pour réessayer.");
      try { await load(); } catch (e) { setError((e as Error).message); }
    } catch (e) { setSearchError((e as Error).message); }
    finally { setSaving(false); }
  }
  async function remove(source: Source) {
    if (!confirm("Supprimer " + source.name + " et ses vidéos de ta bibliothèque ?")) return;
    try {
      await request("/api/sources/" + source.id, { method: "DELETE" });
      if (sourceId === source.id) setSourceId("");
      if (playing?.sourceId === source.id) setPlaying(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function refresh() {
    setRefreshing(true); setError(""); setNotice("");
    try {
      const outcomes = await Promise.allSettled(sources.map(source => request("/api/sources/" + source.id + "/sync", { method: "POST" })));
      await load();
      const failed = outcomes.filter(result => result.status === "rejected").length;
      if (failed) setError(failed + " chaîne(s) n’ont pas pu être actualisées. Réessaie dans un instant.");
      else setNotice("Ta bibliothèque est à jour.");
    } catch (e) { setError((e as Error).message); }
    finally { setRefreshing(false); }
  }
  async function signOut() {
    try { await request("/api/auth/signout", { method: "POST" }); setUser(null); setSources([]); setVideos([]); setPlaying(null); setLibrary(emptyLibrary); }
    catch (e) { setError((e as Error).message); }
  }
  if (user === undefined) return <main className="loading">Chargement de ta bibliothèque…</main>;
  if (!user) return <main className="login-home"><Link href="/" className="brand"><span>◒</span>shelf</Link>{error && <p role="alert" className="form-error">{error}</p>}<section><p className="eyebrow">TA BIBLIOTHÈQUE YOUTUBE</p><h1>Vos chaînes.<br />Votre rythme.</h1><p>Retrouve les vidéos de tes créateurs préférés, regarde-les ici et garde les découvertes pour plus tard.</p><div><Link href="/signup" className="dark-button">Créer un compte</Link><Link href="/signin" className="quiet-button">Se connecter</Link></div></section></main>;
  const filtered = videos.filter(video => (!sourceId || video.sourceId === sourceId) && (view === "all" || library[view].includes(video.id)) && (video.title + " " + video.sourceName).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const title = sourceId ? sources.find(source => source.id === sourceId)?.name || "Chaîne" : view === "saved" ? "À regarder plus tard" : view === "watched" ? "Vidéos vues" : "Toutes les vidéos";
  const playerId = playing ? youtubeVideoId(playing.url) : null;
  const alreadyAdded = (id: string) => sources.some(source => source.feedUrl.includes(id));
  return <main className="dashboard">
    <aside className="side">
      <Link href="/" className="brand"><span>◒</span>shelf</Link>
      <button className="add-source" onClick={openSearch}>＋ Ajouter une chaîne</button>
      <nav className="main-nav" aria-label="Bibliothèque">
        {([["all", "▷", "Toutes les vidéos"], ["saved", "♡", "À regarder plus tard"], ["watched", "✓", "Vidéos vues"]] as const).map(([key, icon, label]) => <button key={key} className={view === key && !sourceId ? "nav-active" : ""} onClick={() => { setView(key); setSourceId(""); }}><span>{icon} {label}</span><small>{key === "all" ? videos.length : videos.filter(video => library[key].includes(video.id)).length}</small></button>)}
      </nav>
      <p className="side-label">TES CHAÎNES <span>{sources.length}</span></p>
      <nav className="channel-nav" aria-label="Chaînes YouTube">{sources.map(source => <div key={source.id} className={sourceId === source.id ? "channel-active" : ""}><button className="channel-filter" onClick={() => { setSourceId(source.id); setView("all"); }}><span className="avatar">{source.name[0]?.toUpperCase()}</span><span>{source.name}</span></button><button className="remove-source" aria-label={"Supprimer " + source.name} onClick={() => remove(source)}>×</button></div>)}{!sources.length && <p>Ta prochaine découverte commence ici.</p>}</nav>
      <div className="account"><span>{(user.name || user.email)[0].toUpperCase()}</span><div><b>{user.name || user.email.split("@")[0]}</b><button onClick={signOut}>Se déconnecter</button></div></div>
    </aside>
    <section className="dashboard-content">
      <header className="page-header"><div><p className="eyebrow">TON ESPACE YOUTUBE</p><h1>À ton rythme.</h1><p>Les créateurs que tu choisis. Les vidéos que tu aimes.</p></div><button className="outline-button" disabled={refreshing || !sources.length} onClick={refresh}>{refreshing ? "Actualisation…" : "↻ Actualiser"}</button></header>
      {error && <div className="feedback error" role="alert"><span>{error}</span><button aria-label="Fermer l’erreur" onClick={() => setError("")}>×</button></div>}
      {notice && <div className="feedback" role="status"><span>{notice}</span><button aria-label="Fermer le message" onClick={() => setNotice("")}>×</button></div>}
      {playing ? <section className="watch-panel" ref={player} tabIndex={-1} aria-label="Lecteur vidéo">
        <div className="watch-heading"><span>EN COURS DE LECTURE</span><button onClick={() => setPlaying(null)} aria-label="Fermer le lecteur">×</button></div>
        {playerId ? <iframe key={playerId} className="youtube-player" src={"https://www.youtube-nocookie.com/embed/" + playerId + "?autoplay=1&rel=0"} title={playing.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : <p className="player-fallback">Cette vidéo ne peut pas être intégrée.</p>}
        <div className="watch-details"><p>{playing.sourceName}</p><h2>{playing.title}</h2><div className="watch-actions"><button className="outline-button" onClick={() => toggleSaved(playing.id)}>{library.saved.includes(playing.id) ? "♥ Enregistrée" : "♡ Garder pour plus tard"}</button><button className="outline-button" onClick={() => updateLibrary({ ...library, watched: library.watched.includes(playing.id) ? library.watched.filter(id => id !== playing.id) : [...library.watched, playing.id] })}>{library.watched.includes(playing.id) ? "✓ Vue" : "Marquer comme vue"}</button><a href={playing.url} target="_blank" rel="noreferrer">Ouvrir sur YouTube ↗</a></div><small>Si YouTube bloque la lecture intégrée, ouvre la vidéo sur YouTube.</small></div>
      </section> : <section className="library-banner"><div><span className="youtube-badge">▶ YOUTUBE, CÔTÉ CALME</span><h2>Moins de bruit.<br />Plus de découvertes.</h2><p>Toutes tes chaînes au même endroit, avec la lecture directement ici.</p><button className="dark-button" onClick={openSearch}>＋ Découvrir une chaîne</button></div><div className="banner-art" aria-hidden="true"><span>▶</span><i>Ta sélection, ton moment.</i></div></section>}
      <div className="library-toolbar"><div><h2>{title}</h2><p>{filtered.length} vidéo{filtered.length !== 1 ? "s" : ""}{videos.length === 100 ? " · les 100 plus récentes" : ""}</p></div><label className="video-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher une vidéo…" aria-label="Rechercher dans les vidéos" /></label></div>
      <div className="filter-row"><button className={!sourceId ? "filter-active" : ""} onClick={() => setSourceId("")}>Toutes les chaînes</button>{sources.map(source => <button key={source.id} className={sourceId === source.id ? "filter-active" : ""} onClick={() => setSourceId(source.id)}>{source.name}</button>)}</div>
      {view !== "all" && <p className="local-note">Tes vidéos enregistrées et vues sont mémorisées dans ce navigateur.</p>}
      {filtered.length ? <div className="video-grid">{filtered.map(video => <article className={"video-card " + (playing?.id === video.id ? "is-playing" : "")} key={video.id}><button className="video-thumb" onClick={() => play(video)} aria-label={"Regarder " + video.title}>{video.imageUrl && <img src={video.imageUrl} alt="" loading="lazy" />}<span className="play-icon">▶</span>{library.watched.includes(video.id) && <span className="watched-badge">✓ Vue</span>}</button><div className="video-meta"><p>{video.sourceName}</p><button className="save-video" aria-label={(library.saved.includes(video.id) ? "Retirer " : "Enregistrer ") + video.title} aria-pressed={library.saved.includes(video.id)} onClick={() => toggleSaved(video.id)}>{library.saved.includes(video.id) ? "♥" : "♡"}</button></div><h3><button onClick={() => play(video)}>{video.title}</button></h3><time dateTime={video.publishedAt || undefined}>{dateLabel(video.publishedAt)}</time></article>)}</div> : <div className="dashboard-empty"><span>▷</span><h2>{!sources.length ? "Ta bibliothèque commence ici" : query ? "Aucune vidéo trouvée" : view === "saved" ? "Garde tes prochaines découvertes" : view === "watched" ? "Chaque vidéo à son rythme" : "Pas encore de vidéos"}</h2><p>{!sources.length ? "Cherche une chaîne YouTube par son nom et retrouve ses dernières vidéos." : query ? "Essaie un autre titre ou le nom d’une chaîne." : view === "saved" ? "Clique sur le cœur d’une vidéo pour la retrouver ici." : view === "watched" ? "Marque une vidéo comme vue depuis le lecteur pour la retrouver ici." : "Actualise tes chaînes pour récupérer leurs vidéos."}</p>{!sources.length && <button className="dark-button" onClick={openSearch}>Ajouter ma première chaîne</button>}</div>}
    </section>
    <dialog ref={dialog} className="channel-dialog" onCancel={event => { if (saving) event.preventDefault(); else setOpen(false); }} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget && !saving) setOpen(false); }}>
      <div className="source-form"><button className="close" disabled={saving} onClick={() => setOpen(false)} aria-label="Fermer">×</button><span className="youtube-badge">▶ UNE NOUVELLE DÉCOUVERTE</span><h2>Ajoute tes créateurs préférés.</h2><p>Recherche une chaîne par son nom, son @handle ou son lien YouTube.</p><label htmlFor="channel-search">Chaîne YouTube</label><input id="channel-search" autoFocus type="search" maxLength={200} value={channel} onChange={event => { setChannel(event.target.value); setSelected(null); setResults([]); setSearchError(""); setSearched(false); setChecking(event.target.value.trim().length >= 2); }} placeholder="Ex. Veritasium, @arte…" disabled={saving} autoComplete="off" />
      <div className="search-status" role="status" aria-live="polite">{checking ? "Recherche sur YouTube…" : searchError ? searchError : searched ? results.length + " chaîne(s) trouvée(s)" : "Commence à écrire · résultats en direct"}</div>
      <div className="channel-results" aria-label="Résultats de recherche">{results.map(result => <button key={result.channelId} disabled={saving || alreadyAdded(result.channelId)} aria-pressed={selected?.channelId === result.channelId} className={"channel-result " + (selected?.channelId === result.channelId ? "selected" : "")} onClick={() => setSelected(result)}>{result.imageUrl ? <img src={result.imageUrl} alt="" /> : <span className="avatar">{result.name[0]?.toUpperCase()}</span>}<span><b>{result.name}</b><small>{alreadyAdded(result.channelId) ? "Déjà dans ta bibliothèque" : result.description || "Chaîne YouTube"}</small><small className="channel-id">{result.channelId}</small></span><span aria-hidden="true">{selected?.channelId === result.channelId || alreadyAdded(result.channelId) ? "✓" : "+"}</span></button>)}</div>
      {searched && !results.length && !checking && <p>Aucune chaîne trouvée. Essaie un autre nom ou colle son lien YouTube.</p>}
      <button className="dark-button" disabled={saving || !selected || checking} onClick={addChannel}>{saving ? "Ajout et récupération des vidéos…" : selected ? "Ajouter " + selected.name : "Sélectionne une chaîne"}</button><small className="local-note">Les dernières vidéos seront ajoutées à ta bibliothèque.</small></div>
    </dialog>
  </main>;
}
