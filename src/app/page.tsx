"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { itemOpening, safeMediaUrl } from "@/lib/item-opening";
import { request } from "@/lib/client";
import { startLegacyMigration } from "@/lib/auth-flow";
import { applyOptimisticItemState, pruneSelection, toggleSelection, updateItemProgress, type ItemStateChange } from "@/lib/feed-state";
import { contentTypes, groupInboxItems, libraryViews, parseLibraryQuery, uuidPattern, type ContentType, type FeedItem, type LibraryPage, type LibraryView } from "@/lib/library";
import { AutomaticSync } from "./components/automatic-sync";
import { AddSource } from "./components/add-source";
import { BulkActionBar } from "./components/bulk-action-bar";
import { ItemCard } from "./components/item-card";
import { SourceBrowser, type SourceSummary } from "./components/source-browser";
import { YouTubePlayer } from "./components/youtube-player";
import { ArticleReader } from "./components/article-reader";
import { PodcastPlayer } from "./components/podcast-player";
import { EditSource } from "./components/edit-source";
import { AccountSettings } from "./components/account-settings";

type User = { id: string; email: string; name: string | null };
type Source = SourceSummary;
type View = LibraryView | "sources";
const navViews: LibraryView[] = ["inbox", "saved", "all", "archive"];
const emptyPage: LibraryPage = { items: [], total: 0, nextOffset: null, counts: { inbox: 0, all: 0, saved: 0, archive: 0 } };
function initialFeedFilters() {
  if (typeof window === "undefined") return parseLibraryQuery(new URLSearchParams());
  try { return parseLibraryQuery(new URLSearchParams(window.location.search)); }
  catch { return parseLibraryQuery(new URLSearchParams()); }
}
// Preserve saved/viewed choices made with the previous browser-only library.
async function migrateBrowserState(userId: string) {
  let stored;
  try {
    if (localStorage.getItem("shelf:migrated:" + userId)) return;
    stored = JSON.parse(localStorage.getItem("shelf:" + userId) || "null");
  } catch { return; }
  if (!stored) return;
  for (const [key, field] of [["saved", "saved"], ["watched", "read"]] as const) {
    const ids = Array.isArray(stored[key]) ? stored[key].filter((id: unknown) => typeof id === "string" && uuidPattern.test(id)) : [];
    for (let index = 0; index < ids.length; index += 100) {
      await request("/api/items/state", { method: "PATCH", timeoutMs: 12_000, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(index, index + 100), [field]: true }) });
    }
  }
  try { localStorage.setItem("shelf:migrated:" + userId, "1"); } catch { /* Server state is already saved. */ }
}

function ItemGrid({ items, selected, playingId, changing, onSelect, onOpen, onSource, onSave, onSeen }: {
  items: FeedItem[];
  selected: Set<string>;
  playingId?: string;
  changing: boolean;
  onSelect(item: FeedItem): void;
  onOpen(item: FeedItem): void;
  onSource(sourceId: string): void;
  onSave(item: FeedItem): void;
  onSeen(item: FeedItem): void;
}) {
  return <div className="video-grid">{items.map(item => <ItemCard key={item.id} item={item} selected={selected.has(item.id)} active={playingId === item.id} changing={changing} onSelect={onSelect} onOpen={onOpen} onSource={onSource} onSave={onSave} onSeen={onSeen} />)}</div>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>();
  const [accountRevision, setAccountRevision] = useState(0);
  const [sources, setSources] = useState<Source[]>([]);
  const [page, setPage] = useState<LibraryPage>(emptyPage);
  const [view, setView] = useState<View>(() => initialFeedFilters().view);
  const [sourceId, setSourceId] = useState(() => initialFeedFilters().sourceId);
  const [contentType, setContentType] = useState<ContentType>(() => initialFeedFilters().contentType);
  const [query, setQuery] = useState(() => initialFeedFilters().query);
  const [search, setSearch] = useState(() => initialFeedFilters().query);
  const [sort, setSort] = useState(() => initialFeedFilters().sort);
  const [category, setCategory] = useState(() => initialFeedFilters().category || "");
  const [status, setStatus] = useState(() => initialFeedFilters().status || "all");
  const [savedOnly, setSavedOnly] = useState(() => initialFeedFilters().savedOnly || false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [feedRevision, setFeedRevision] = useState(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [readerExpanded, setReaderExpanded] = useState(false);
  const [playing, setPlaying] = useState<FeedItem | null>(null);
  const [completionSuppressedId, setCompletionSuppressedId] = useState<string | null>(null);
  const [cleaningShorts, setCleaningShorts] = useState(false);
  const [shortCursors, setShortCursors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const player = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const changeLock = useRef(false);
  const moreLock = useRef(false);
  useEffect(() => {
    request("/api/auth/me").then(({ user: account }) => {
      if (!account) { setUser(null); return; }
      startLegacyMigration(account, setUser, migrateBrowserState, () => setNotice("Tes anciens enregistrements restent dans ce navigateur. Leur transfert sera réessayé à la prochaine connexion."));
    }).catch(() => { setUser(null); setError("Connexion au serveur impossible."); });
  }, [accountRevision]);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    function restoreFromHistory() {
      try {
        const restored = parseLibraryQuery(new URLSearchParams(window.location.search));
        setView(restored.view); setSourceId(restored.sourceId); setContentType(restored.contentType);
        setCategory(restored.category || ""); setStatus(restored.status || "all"); setSavedOnly(restored.savedOnly || false); setQuery(restored.query); setSearch(restored.query); setSort(restored.sort); setSelected(new Set());
      } catch { /* Keep the current valid UI state for malformed history entries. */ }
    }
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, []);
  const params = new URLSearchParams({ view: view === "sources" ? "all" : view, source: sourceId, q: search, sort, type: contentType, category, status, saved:String(savedOnly) }).toString();
  useEffect(() => {
    if (!user || view === "sources") return;
    const controller = new AbortController();
    generation.current++;
    async function load() {
      setLoading(true); setMoreLoading(false);
      try {
        const data = await request("/api/items?" + params, { signal: controller.signal });
        if (!controller.signal.aborted) setPage(data);
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setPage(previous => ({ ...emptyPage, counts: previous.counts })); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [user, view, params, feedRevision]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    async function loadSources() {
      setSourcesLoading(true);
      try {
        const data = await request("/api/sources", { signal: controller.signal });
        if (!controller.signal.aborted) setSources(data.sources);
      } catch (error) { if (!controller.signal.aborted) setError((error as Error).message); }
      finally { if (!controller.signal.aborted) setSourcesLoading(false); }
    }
    void loadSources();
    return () => controller.abort();
  }, [user, sourceRevision]);
  useEffect(() => {
    if (view === "sources") return;
    history.replaceState(null, "", "?" + params);
  }, [params, view]);
  async function more() {
    if (page.nextOffset === null || moreLock.current || loading) return;
    const current = generation.current;
    moreLock.current = true; setMoreLoading(true);
    try {
      const data: LibraryPage = await request("/api/items?" + params + "&offset=" + page.nextOffset);
      if (current === generation.current) setPage(previous => ({ ...data, items: [...previous.items, ...data.items.filter(item => !previous.items.some(old => old.id === item.id))] }));
    } catch (e) { if (current === generation.current) setError((e as Error).message); }
    finally { moreLock.current = false; if (current === generation.current) setMoreLoading(false); }
  }
  function navigate(next: View, source = "") {
    closePlayer();
    setCategory(""); setStatus("all"); setSavedOnly(false); setView(next); setSourceId(source); setQuery(""); setSearch(""); setError(""); setSelected(new Set());
    if (source) setContentType(sources.find(value => value.id === source)?.contentType || "all");
    // The fetch effect owns loading; selecting the current view needs no request.
  }
  useEffect(() => {
    if (!readerExpanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = [...document.querySelectorAll<HTMLElement>(".side, .dashboard-content > :not(.watch-panel)")];
    const inertStates = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    player.current?.focus({ preventScroll:true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReaderExpanded(false);
      if (event.key !== "Tab" || !player.current) return;
      const controls = [...player.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === player.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", escape);
    return () => { background.forEach((element,index) => { element.inert = inertStates[index]; }); document.body.style.overflow = previous; window.removeEventListener("keydown", escape); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll:true }); };
  }, [readerExpanded]);
  async function changeState(ids: string[], fields: ItemStateChange, automatic = false) {
    if (changeLock.current || !ids.length) return false;
    changeLock.current = true; setChanging(true); setError("");
    if (playing && ids.includes(playing.id) && fields.read !== undefined) setCompletionSuppressedId(fields.read || automatic ? null : playing.id);
    const previousSuppression = completionSuppressedId;
    const previousPage = page;
    const previousPlaying = playing;
    const previousSelection = selected;
    const currentView = view === "sources" ? "all" : view;
    const optimistic = applyOptimisticItemState(page, ids, fields, currentView);
    setPage(optimistic);
    setPlaying(previous => previous && ids.includes(previous.id) ? { ...previous, ...fields } : previous);
    setSelected(previous => pruneSelection(previous, optimistic.items));
    try {
      for (let start = 0; start < ids.length; start += 100) await request("/api/items/state", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(start, start + 100), ...fields }),
      });
      if (category || status !== "all" || savedOnly) setFeedRevision(value => value + 1);
      if (fields.read !== undefined) setNotice(fields.read ? "Contenu marqué comme vu. Il reste dans la Bibliothèque et sa Source." : "Contenu marqué comme nouveau.");
    } catch (e) { setPage(previousPage); setPlaying(previousPlaying); setSelected(previousSelection); setCompletionSuppressedId(previousSuppression); setError((e as Error).message); return false; }
    finally { changeLock.current = false; setChanging(false); }
    return true;
  }
  async function markAllResultsSeen() {
    if (changing || !page.total || !confirm("Marquer les " + page.total + " résultats actuels comme vus ? Ils resteront dans la Bibliothèque et sous leur Source.")) return;
    changeLock.current = true; setChanging(true); setError("");
    try {
      const result = await request("/api/items/state?" + params, { method: "POST" });
      setNotice(result.affected + " contenu(s) marqué(s) comme vus.");
      setPlaying(previous => previous && page.items.some(item => item.id === previous.id) ? { ...previous, read: true } : previous);
      setSelected(new Set());
      setFeedRevision(value => value + 1);
    } catch (e) { setError((e as Error).message); }
    finally { changeLock.current = false; setChanging(false); }
  }
  function play(item: FeedItem) {
    if (playing?.id !== item.id) setCompletionSuppressedId(null);
    setPlaying(item);
    requestAnimationFrame(() => { player.current?.scrollIntoView({ behavior: "smooth", block: "start" }); player.current?.focus({ preventScroll: true }); });
  }
  function updateProgress(itemId: string, progressSeconds: number, durationSeconds: number | null, lastPlayedAt: string) {
    setPage(previous => updateItemProgress(previous, itemId, progressSeconds, durationSeconds, lastPlayedAt));
    setPlaying(previous => previous?.id === itemId ? { ...previous, progressSeconds, durationSeconds: durationSeconds ?? previous.durationSeconds, lastPlayedAt } : previous);
  }
  function closePlayer() { setReaderExpanded(false); setPlaying(null); setCompletionSuppressedId(null); }
  async function refresh(source?: Source) {
    if (refreshing) return;
    setRefreshing(true); setError(""); setNotice("");
    try {
      const { synced, failed, imported, remaining = [] } = await request(source ? "/api/sources/" + source.id + "/sync" : "/api/sources/sync", { method: "POST", timeoutMs: 310_000 });
      if (failed) setError(failed + " source(s) indisponible(s). Les autres flux ont été actualisés.");
      setNotice(synced + " source(s) actualisée(s). " + (imported ? imported + " nouveau(x) contenu(s) dans Nouveautés." : "Aucun nouveau contenu récupéré.") + (remaining.length ? " " + remaining.length + " source(s) reportée(s). Relance l’actualisation pour continuer ; le cron les reprendra aussi." : ""));
      setFeedRevision(value => value + 1);
      setSourceRevision(value => value + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setRefreshing(false); }
  }
  async function remove(source: Source) {
    if (!confirm("Supprimer " + source.name + " et tous ses contenus collectés, y compris les contenus vus et enregistrés ?")) return;
    try {
      await request("/api/sources/" + source.id, { method: "DELETE" });
      setSources(previous => previous.filter(value => value.id !== source.id));
      if (sourceId === source.id) { setSourceId(""); setView("inbox"); setContentType("all"); }
      if (playing?.sourceId === source.id) setPlaying(null);
      setNotice("Source supprimée avec ses contenus. Cette suppression est définitive.");
      setSelected(new Set());
      setFeedRevision(value => value + 1);
    } catch (e) { setError((e as Error).message); }
  }
  async function signOut() {
    try { await request("/api/auth/signout", { method: "POST" }); setUser(null); setShortCursors({}); setSources([]); setPage(emptyPage); setPlaying(null); }
    catch (e) { setError((e as Error).message); }
  }
  async function removeShorts() {
    if (cleaningShorts || !confirm("Retirer définitivement tous les Shorts déjà importés ? Les vidéos normales, tes sources et tes autres contenus restent inchangés.")) return;
    setCleaningShorts(true); setError("");
    try {
      const result = await request("/api/items/shorts", { method: "DELETE", timeoutMs: 310_000, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cursors: shortCursors }) });
      setShortCursors(result.cursors || {});
      setNotice((result.removed ? result.removed + " Short(s) retiré(s)." : "Aucun Short retiré dans ce lot.") + (Object.keys(result.cursors || {}).length ? " Clique sur Continuer le nettoyage pour examiner la suite ou réessayer les sources en échec." : " Nettoyage terminé."));
      if (result.failed) setError(result.failed + " source(s) non vérifiée(s). Réessaie ; YouTube peut bloquer temporairement la lecture de son onglet Shorts.");
      closePlayer(); setSelected(new Set()); setFeedRevision(value => value + 1);
    } catch (error) { setError((error as Error).message); }
    finally { setCleaningShorts(false); }
  }
  if (user === undefined) return <main className="loading">Ouverture de tes flux…</main>;
  if (!user && error) return <main className="login-home"><Link href="/" className="brand"><span>◒</span>shelf</Link><section><p role="alert" className="form-error">{error}</p><button className="outline-button" onClick={() => { setError(""); setUser(undefined); setAccountRevision(value => value + 1); }}>Réessayer</button></section></main>;
  if (!user) return <main className="login-home"><Link href="/" className="brand"><span>◒</span>shelf</Link>{error && <p role="alert" className="form-error">{error}</p>}<section><p className="eyebrow">TES SOURCES. TON ESPACE.</p><h1>Tout suivre.<br />À ton rythme.</h1><p>Un agrégateur pour rassembler tes sources, découvrir leurs nouveautés et garder ce qui compte. Commence avec tes flux de vidéos.</p><div><Link href="/signup" className="dark-button">Créer un compte</Link><Link href="/signin" className="quiet-button">Se connecter</Link></div></section></main>;
  const currentSource = sources.find(source => source.id === sourceId);
  const title = view === "sources" ? "Sources" : currentSource ? currentSource.name : libraryViews[view].label;
  const description = currentSource ? "Tout l’historique collecté pour cette source, y compris les contenus déjà vus." : "";
  const opening = playing ? itemOpening(playing) : null;
  const inboxGroups = view === "inbox" ? groupInboxItems(page.items) : [];
  const selectedIds = [...selected];
  const allVisibleSelected = Boolean(page.items.length) && page.items.every(item => selected.has(item.id));
  return <main className="dashboard">
    <aside className="side">
      <button className="brand brand-button" onClick={() => { closePlayer(); setView("inbox"); setSourceId(""); setContentType("all"); setQuery(""); setSearch(""); setSelected(new Set()); history.replaceState(null, "", "/"); }}><span>◒</span>shelf</button>
      <button className="add-source" onClick={() => setOpen(true)}>＋ Ajouter des sources</button>
      <nav className="main-nav" aria-label="Navigation principale">
        {navViews.map(key => <button key={key} className={view === key && !sourceId ? "nav-active" : ""} aria-current={view === key && !sourceId ? "page" : undefined} onClick={() => navigate(key)}><span>{libraryViews[key].icon} {libraryViews[key].label}</span><small>{page.counts[key]}</small></button>)}
      </nav>
      <p className="side-label">CONTENU</p>
      <nav className="content-nav" aria-label="Types de contenu">{(Object.keys(contentTypes) as ContentType[]).map(type => <button key={type} className={contentType === type && view !== "sources" ? "nav-active" : ""} onClick={() => { closePlayer(); setContentType(type); setSourceId(""); setSelected(new Set()); if (view === "sources") setView("inbox"); }}><span>{contentTypes[type].icon} {contentTypes[type].label}</span></button>)}</nav>
      <p className="side-label">SOURCES <span>{sources.length}</span></p>
      <nav className="content-nav" aria-label="Sources"><button className={view === "sources" ? "nav-active" : ""} aria-current={view === "sources" ? "page" : undefined} onClick={() => navigate("sources")}><span>◉ Parcourir les sources</span></button></nav>
      <button className="account" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog"><span>{(user.name || user.email)[0].toUpperCase()}</span><div><b>{user.name || user.email.split("@")[0]}</b><small>Réglages du compte</small></div><i aria-hidden="true">›</i></button>
    </aside>
    <section className="dashboard-content">
      <AutomaticSync revision={sourceRevision} />
      <header className="page-header"><div><p className="eyebrow">TON AGRÉGATEUR PERSONNEL</p><h1>{title}</h1>{description && <p>{description}</p>}</div><button className="outline-button" disabled={refreshing || !sources.some(source => source.active)} onClick={() => refresh()}>{refreshing ? "Actualisation…" : "↻ Actualiser les flux"}</button></header>
      {error && <div className="feedback error" role="alert"><span>{error}</span><button aria-label="Fermer l’erreur" onClick={() => setError("")}>×</button></div>}
      {notice && <div className="feedback" role="status"><span>{notice}</span><button aria-label="Fermer le message" onClick={() => setNotice("")}>×</button></div>}
      {playing && <section className={"watch-panel" + (readerExpanded ? " reader-expanded" : "")} role={readerExpanded ? "dialog" : undefined} aria-modal={readerExpanded || undefined} ref={player} tabIndex={-1} aria-label={playing.mediaType === "article" ? "Lecteur d’article" : playing.mediaType === "podcast" ? "Lecteur podcast" : "Lecteur vidéo"}>
        <div className="watch-heading"><span>EN COURS DE LECTURE · {playing.sourceName}</span><div>{playing.mediaType === "article" && <button className="reader-expand" aria-pressed={readerExpanded} onClick={() => setReaderExpanded(value => !value)}>{readerExpanded ? "Réduire" : "Plein écran"}</button>}<button onClick={closePlayer} aria-label="Fermer le lecteur">×</button></div></div>
        {opening?.kind === "article" ? <ArticleReader key={playing.id} item={playing} suppressAutoSeen={completionSuppressedId === playing.id} onStart={() => playing.read ? changeState([playing.id], { read:false }, true) : true} onProgress={(progress, duration, at) => updateProgress(playing.id, progress, duration, at)} onComplete={() => changeState([playing.id], { read:true })} onWarning={setNotice} /> : opening?.kind === "podcast" ? <PodcastPlayer key={playing.id} itemId={playing.id} audioUrl={opening.audioUrl} onStart={() => playing.read ? changeState([playing.id], { read:false }, true) : true} initialProgress={playing.progressSeconds} initialDuration={playing.durationSeconds} suppressAutoSeen={completionSuppressedId === playing.id} onProgress={(progressSeconds, durationSeconds, lastPlayedAt) => updateProgress(playing.id, progressSeconds, durationSeconds, lastPlayedAt)} onComplete={() => changeState([playing.id], { read: true })} onWarning={message => setNotice(message)} /> : opening?.kind === "youtube" ? <YouTubePlayer key={playing.id} itemId={playing.id} videoId={opening.videoId} initialProgress={playing.progressSeconds} initialDuration={playing.durationSeconds} suppressAutoSeen={completionSuppressedId === playing.id} onProgress={(progressSeconds, durationSeconds, lastPlayedAt) => updateProgress(playing.id, progressSeconds, durationSeconds, lastPlayedAt)} onComplete={() => changeState([playing.id], { read: true })} onWarning={message => setNotice(message)} /> : <p className="player-fallback">Ce contenu ne peut pas être lu ici. Ouvre-le sur le site de la source.</p>}
        <div className="watch-details">{playing.mediaType !== "article" && <h2>{playing.title}</h2>}<div className="watch-actions"><button className="outline-button" disabled={changing} onClick={() => changeState([playing.id], { saved: !playing.saved })}>{playing.saved ? "♥ Enregistrée" : "♡ Enregistrer"}</button><button className="outline-button" disabled={changing} onClick={() => changeState([playing.id], { read: !playing.read })}>{playing.read ? "Marquer comme nouveau" : playing.mediaType === "article" ? "Marquer comme lu" : "Marquer comme vu"}</button><a href={safeMediaUrl(playing.url) || undefined} target="_blank" rel="noreferrer">Ouvrir sur {playing.sourceKind === "youtube" ? "YouTube" : "le site"} ↗</a></div></div>
      </section>}
      {view === "sources" ? <SourceBrowser sources={sources} loading={sourcesLoading} refreshing={refreshing} cleaningShorts={cleaningShorts} cleanupMore={Object.keys(shortCursors).length > 0} onToggle={async source => { try { const data = await request(`/api/sources/${source.id}`, { method:"PATCH",headers:{ "Content-Type":"application/json" },body:JSON.stringify({ active:!source.active }) }); setSources(previous => previous.map(old => old.id === source.id ? data.source : old)); setSourceRevision(value => value+1); } catch (error) { setError((error as Error).message); } }} onCategory={async (ids, category) => { await request("/api/sources/category", { method:"PATCH", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ ids,category }) }); setSourceRevision(value => value+1); setFeedRevision(value => value+1); }} onAdd={() => setOpen(true)} onOpen={source => navigate("all", source.id)} onRefresh={source => void refresh(source)} onEdit={setEditingSource} onRemove={source => void remove(source)} onRemoveShorts={() => void removeShorts()} /> : <>
        <div className="feed-overview"><span className="content-type">{contentTypes[contentType].icon} {contentTypes[contentType].label}</span><span>{view === "inbox" ? page.total + " à découvrir" : page.total + " contenu(s) dans cette vue"}</span><span className="overview-end">Tes flux, sans perdre le fil.</span></div>
        <div className="content-filters" aria-label="Filtrer par type de contenu">{(Object.keys(contentTypes) as ContentType[]).map(type => <button key={type} className={contentType === type ? "filter-active" : ""} aria-pressed={contentType === type} onClick={() => { closePlayer(); setContentType(type); setSelected(new Set()); }}>{contentTypes[type].label}</button>)}</div>
        <div className="library-toolbar"><div><h2>{currentSource ? "Historique de la source" : "Toutes les sources"}</h2><p>{loading ? "Chargement…" : page.total + " contenu(s)"}{view === "all" && " · historique collecté"}</p></div><label className="video-search"><span aria-hidden="true">⌕</span><input type="search" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setSelected(new Set()); }} placeholder="Titre, auteur, source ou contenu…" aria-label="Rechercher dans les flux" /></label></div>
        {currentSource && <div className="source-status" aria-label="Filtrer l’historique par statut"><span>Statut</span>{([{"view":"all","label":"Toutes"},{"view":"inbox","label":"Nouvelles"},{"view":"archive","label":"Vues"}] as const).map(option => <button key={option.view} className={view === option.view ? "filter-active" : ""} aria-pressed={view === option.view} onClick={() => navigate(option.view, currentSource.id)}>{option.label}</button>)}</div>}
        <div className="feed-controls"><label>Catégorie<select value={category} onChange={event => { setCategory(event.target.value); setSelected(new Set()); }}><option value="">Toutes les catégories</option>{[...new Set(sources.map(source => source.category))].sort().map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Lecture<select value={status} onChange={event => { setStatus(event.target.value as typeof status); setSelected(new Set()); }}><option value="all">Tous les états</option><option value="unread">Non lus / non terminés</option><option value="in_progress">En cours</option><option value="read">Lus / terminés</option></select></label><label className="saved-filter"><input type="checkbox" checked={savedOnly} onChange={event => { setSavedOnly(event.target.checked); setSelected(new Set()); }} />Enregistrés uniquement</label><label>Source<select value={sourceId} onChange={event => { closePlayer(); const nextSource = event.target.value; setSourceId(nextSource); setSelected(new Set()); if (nextSource) { setView("all"); setContentType(sources.find(source => source.id === nextSource)?.contentType || "all"); } }}><option value="">Toutes les sources</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label><label>Trier<select value={sort} onChange={event => { setSort(event.target.value === "oldest" ? "oldest" : "newest"); }}><option value="newest">Plus récentes d’abord</option><option value="oldest">Plus anciennes d’abord</option></select></label><button className="quiet-button select-visible" disabled={loading || !page.items.length} onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(page.items.map(item => item.id)))}>{allVisibleSelected ? "Effacer la sélection" : "Sélectionner les éléments visibles"}</button>{view === "inbox" && <div className="bulk-actions"><button className="quiet-button" disabled={changing || loading || !page.items.length} onClick={() => { if (confirm("Marquer les " + page.items.length + " contenus affichés comme vus ?")) void changeState(page.items.map(item => item.id), { read: true }); }}>✓ Marquer les éléments affichés comme vus</button><button className="quiet-button" disabled={changing || loading || !page.total} onClick={markAllResultsSeen}>✓ Marquer tous les résultats actuels comme vus</button></div>}</div>
        <BulkActionBar count={selected.size} seenView={view === "archive"} changing={changing} onSeen={read => void changeState(selectedIds, { read })} onSave={saved => void changeState(selectedIds, { saved })} onUnsave={saved => void changeState(selectedIds, { saved })} onClear={() => setSelected(new Set())} />
        {loading ? <div role="status" className="list-loading">Chargement des flux…</div> : error && !page.items.length ? <div className="dashboard-empty"><span>!</span><h2>Impossible de charger les flux</h2><p>{error}</p><button className="outline-button" onClick={() => { setError(""); setFeedRevision(value => value + 1); }}>Réessayer</button></div> : page.items.length ? <>
          {view === "inbox" ? inboxGroups.map(group => <section className="inbox-group" key={group.label}><h2>{group.label}</h2><ItemGrid items={group.items} selected={selected} playingId={playing?.id} changing={changing} onSelect={item => setSelected(previous => toggleSelection(previous, item.id))} onOpen={play} onSource={id => navigate("all", id)} onSave={item => void changeState([item.id], { saved: !item.saved })} onSeen={item => void changeState([item.id], { read: !item.read })} /></section>) : <ItemGrid items={page.items} selected={selected} playingId={playing?.id} changing={changing} onSelect={item => setSelected(previous => toggleSelection(previous, item.id))} onOpen={play} onSource={id => navigate("all", id)} onSave={item => void changeState([item.id], { saved: !item.saved })} onSeen={item => void changeState([item.id], { read: !item.read })} />}
          <div className="pagination"><p>{page.items.length} sur {page.total} contenu(s)</p>{page.nextOffset !== null && <button className="outline-button" disabled={moreLoading || changing} onClick={more}>{moreLoading ? "Chargement…" : "Charger la suite"}</button>}</div>
        </> : <div className="dashboard-empty"><span>{view === "inbox" ? "✓" : "▤"}</span><h2>{!sources.length ? "Tes sources donnent vie à tes nouveautés" : search ? "Aucun contenu pour ces filtres" : view === "inbox" ? "Tu es à jour" : view === "archive" ? "Aucun contenu vu" : view === "saved" ? "Garde ce qui compte" : "Le premier contenu arrive bientôt"}</h2><p>{!sources.length ? "Ajoute des sources pour recevoir leurs nouveautés et commencer ta bibliothèque." : search ? "Essaie une autre recherche." : view === "inbox" ? "Les prochains contenus arriveront ici. Les contenus vus restent dans la Bibliothèque et sous leur Source." : view === "archive" ? "Les contenus marqués comme vus apparaîtront ici sans quitter ta bibliothèque." : view === "saved" ? "Enregistre un contenu pour le retrouver ici, qu’il soit nouveau ou déjà vu." : "Actualise tes sources pour récupérer les contenus disponibles."}</p>{!sources.length ? <button className="dark-button" onClick={() => setOpen(true)}>Ajouter des sources</button> : view === "inbox" && <button className="outline-button" onClick={() => navigate("all", sourceId)}>Explorer la bibliothèque</button>}</div>}
        {view === "all" && <p className="history-note">Shelf conserve tout ce qu’il collecte après l’ajout d’une source. Le flux YouTube fournit seulement les publications récentes disponibles, pas l’historique complet antérieur de la chaîne.</p>}
      </>}
    </section>
    {open && <AddSource categories={[...new Set(sources.map(source => source.category))].sort()} feedUrls={sources.map(source => source.feedUrl)} onClose={() => setOpen(false)} onAdded={message => { setOpen(false); navigate("inbox"); setNotice(message); setSourceRevision(value => value + 1); setFeedRevision(value => value + 1); }} />}
    {editingSource && <EditSource source={editingSource} onClose={() => setEditingSource(null)} onSaved={source => { setEditingSource(null); setSources(previous => previous.map(old => old.id === source.id ? source : old)); setPlaying(previous => previous?.sourceId === source.id ? { ...previous, sourceName: source.name } : previous); setNotice("Source mise à jour."); setSourceRevision(value => value + 1); setFeedRevision(value => value + 1); }} />}
    {settingsOpen && <AccountSettings onClose={() => setSettingsOpen(false)} onSignOut={() => { setSettingsOpen(false); void signOut(); }} />}
  </main>;
}
