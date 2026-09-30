"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { youtubeVideoId } from "@/lib/video";
import { request } from "@/lib/client";
import { libraryViews, uuidPattern, type FeedItem, type LibraryPage, type LibraryView } from "@/lib/library";
import { AddSource } from "./components/add-source";

type User = { id: string; email: string; name: string | null };
type Source = { id: string; name: string; feedUrl: string; siteUrl: string | null; kind: string; category: string };
type View = LibraryView | "sources";
const emptyPage: LibraryPage = { items: [], total: 0, nextOffset: null, counts: { inbox: 0, all: 0, saved: 0, archive: 0 } };
function dateLabel(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium" }).format(date) : "";
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
      await request("/api/items/state", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(index, index + 100), [field]: true }) });
    }
  }
  try { localStorage.setItem("shelf:migrated:" + userId, "1"); } catch { /* Server state is already saved. */ }
}
export default function Home() {
  const [user, setUser] = useState<User | null>();
  const [sources, setSources] = useState<Source[]>([]);
  const [page, setPage] = useState<LibraryPage>(emptyPage);
  const [view, setView] = useState<View>("inbox");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState<FeedItem | null>(null);
  const player = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const changeLock = useRef(false);
  const moreLock = useRef(false);
  const reload = () => setRevision(value => value + 1);
  useEffect(() => {
    request("/api/auth/me").then(async ({ user: account }) => {
      if (account) {
        try { await migrateBrowserState(account.id); }
        catch { setNotice("Tes anciens favoris restent dans ce navigateur. Leur transfert sera réessayé à la prochaine connexion."); }
      }
      setUser(account || null);
    }).catch(() => { setUser(null); setError("Connexion au serveur impossible. Recharge la page pour réessayer."); });
  }, []);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const params = new URLSearchParams({ view: view === "sources" ? "all" : view, source: sourceId, q: search, sort, type: "video" }).toString();
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    generation.current++;
    async function load() {
      setLoading(true); setMoreLoading(false);
      try {
        const [data, sourceData] = await Promise.all([request("/api/items?" + params, { signal: controller.signal }), request("/api/sources", { signal: controller.signal })]);
        if (!controller.signal.aborted) { setPage(data); setSources(sourceData.sources); }
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setPage(previous => ({ ...emptyPage, counts: previous.counts })); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [user, params, revision]);
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
    setView(next); setSourceId(source); setQuery(""); setSearch(""); setError(""); setLoading(true);
    reload();
  }
  async function changeState(ids: string[], fields: { read?: boolean; saved?: boolean }) {
    if (changeLock.current || !ids.length) return;
    changeLock.current = true; setChanging(true); setError("");
    try {
      // Apply a visible batch in bounded requests. The server checks ownership of every item.
      for (let start = 0; start < ids.length; start += 100) await request("/api/items/state", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(start, start + 100), ...fields }),
      });
      setPlaying(previous => previous && ids.includes(previous.id) ? { ...previous, ...fields } : previous);
      if (fields.read !== undefined) setNotice(fields.read ? "Contenu archivé : tu le retrouveras dans Archives et Bibliothèque." : "Contenu remis dans la boîte de réception.");
      reload();
    } catch (e) { setError((e as Error).message); reload(); }
    finally { changeLock.current = false; setChanging(false); }
  }
  function play(item: FeedItem) {
    setPlaying(item);
    requestAnimationFrame(() => { player.current?.scrollIntoView({ behavior: "smooth", block: "start" }); player.current?.focus({ preventScroll: true }); });
  }
  async function refresh(source?: Source) {
    if (refreshing) return;
    setRefreshing(true); setError(""); setNotice("");
    try {
      const targets = source ? [source] : sources.filter(value => value.kind === "youtube");
      const results = await Promise.allSettled(targets.map(value => request("/api/sources/" + value.id + "/sync", { method: "POST" })));
      const failed = results.filter(result => result.status === "rejected").length;
      const imported = results.reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value.imported : 0), 0);
      if (failed) setError(failed + " source(s) indisponible(s). Les autres flux ont été actualisés.");
      setNotice(imported ? imported + " nouvelle(s) vidéo(s) dans ta boîte de réception." : "Actualisation terminée. Aucun nouveau contenu récupéré.");
      reload();
    } catch (e) { setError((e as Error).message); }
    finally { setRefreshing(false); }
  }
  async function remove(source: Source) {
    if (!confirm("Supprimer " + source.name + " et tous ses contenus collectés, y compris les archives et favoris ?")) return;
    try {
      await request("/api/sources/" + source.id, { method: "DELETE" });
      if (sourceId === source.id) setSourceId("");
      if (playing?.sourceId === source.id) setPlaying(null);
      setNotice("Source supprimée avec ses contenus. Cette suppression est définitive.");
      reload();
    } catch (e) { setError((e as Error).message); }
  }
  async function signOut() {
    try { await request("/api/auth/signout", { method: "POST" }); setUser(null); setSources([]); setPage(emptyPage); setPlaying(null); }
    catch (e) { setError((e as Error).message); }
  }
  if (user === undefined) return <main className="loading">Ouverture de tes flux…</main>;
  if (!user) return <main className="login-home"><Link href="/" className="brand"><span>◒</span>shelf</Link>{error && <p role="alert" className="form-error">{error}</p>}<section><p className="eyebrow">TES SOURCES. TON ESPACE.</p><h1>Tout suivre.<br />À ton rythme.</h1><p>Un agrégateur pour rassembler tes sources, découvrir leurs nouveautés et garder ce qui compte. Commence avec tes flux de vidéos.</p><div><Link href="/signup" className="dark-button">Créer un compte</Link><Link href="/signin" className="quiet-button">Se connecter</Link></div></section></main>;
  const currentSource = sources.find(source => source.id === sourceId);
  const title = view === "sources" ? "Sources" : libraryViews[view].label;
  const description = view === "sources" ? "Les flux que tu suis et qui alimentent ta boîte de réception." : libraryViews[view].description;
  const playerId = playing ? youtubeVideoId(playing.url) : null;
  return <main className="dashboard">
    <aside className="side">
      <Link href="/" className="brand"><span>◒</span>shelf</Link>
      <button className="add-source" onClick={() => setOpen(true)}>＋ Ajouter une source</button>
      <nav className="main-nav" aria-label="Navigation principale">
        {(Object.keys(libraryViews) as LibraryView[]).map(key => <button key={key} className={view === key ? "nav-active" : ""} aria-current={view === key ? "page" : undefined} onClick={() => navigate(key)}><span>{libraryViews[key].icon} {libraryViews[key].label}</span><small>{page.counts[key]}</small></button>)}
        <button className={view === "sources" ? "nav-active" : ""} aria-current={view === "sources" ? "page" : undefined} onClick={() => navigate("sources")}><span>◉ Sources</span><small>{sources.length}</small></button>
      </nav>
      <p className="side-label">MES FLUX <span>{sources.length}</span></p>
      <nav className="channel-nav" aria-label="Mes flux">{sources.map(source => <div key={source.id} className={sourceId === source.id ? "channel-active" : ""}><button className="channel-filter" onClick={() => navigate("all", source.id)}><span className="avatar">{source.name[0]?.toUpperCase()}</span><span>{source.name}</span></button></div>)}{!sources.length && <p>Ajoute une source pour recevoir ses nouveautés.</p>}</nav>
      <div className="account"><span>{(user.name || user.email)[0].toUpperCase()}</span><div><b>{user.name || user.email.split("@")[0]}</b><button onClick={signOut}>Se déconnecter</button></div></div>
    </aside>
    <section className="dashboard-content">
      <header className="page-header"><div><p className="eyebrow">TON AGRÉGATEUR PERSONNEL</p><h1>{title}</h1><p>{description}</p></div><button className="outline-button" disabled={refreshing || !sources.some(source => source.kind === "youtube")} onClick={() => refresh()}>{refreshing ? "Actualisation…" : "↻ Actualiser les flux"}</button></header>
      {error && <div className="feedback error" role="alert"><span>{error}</span><button aria-label="Fermer l’erreur" onClick={() => setError("")}>×</button></div>}
      {notice && <div className="feedback" role="status"><span>{notice}</span><button aria-label="Fermer le message" onClick={() => setNotice("")}>×</button></div>}
      {playing && <section className="watch-panel" ref={player} tabIndex={-1} aria-label="Lecteur vidéo">
        <div className="watch-heading"><span>EN COURS DE LECTURE · {playing.sourceName}</span><button onClick={() => setPlaying(null)} aria-label="Fermer le lecteur">×</button></div>
        {playerId ? <iframe key={playerId} className="youtube-player" src={"https://www.youtube-nocookie.com/embed/" + playerId + "?autoplay=1&rel=0"} title={playing.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : <p className="player-fallback">Cette vidéo ne peut pas être intégrée. Ouvre-la sur le site de la source.</p>}
        <div className="watch-details"><h2>{playing.title}</h2><div className="watch-actions"><button className="outline-button" disabled={changing} onClick={() => changeState([playing.id], { saved: !playing.saved })}>{playing.saved ? "♥ Enregistrée" : "♡ À retrouver"}</button><button className="outline-button" disabled={changing} onClick={() => changeState([playing.id], { read: !playing.read })}>{playing.read ? "Remettre dans la boîte" : "Terminer et archiver"}</button><a href={playing.url} target="_blank" rel="noreferrer">Ouvrir sur {playing.sourceKind === "youtube" ? "YouTube" : "le site"} ↗</a></div><small>La lecture ne retire pas la vidéo de ta boîte. Archive-la quand tu as terminé. Si la lecture est bloquée, ouvre le site de la source.</small></div>
      </section>}
      {view === "sources" ? <section className="sources-page" aria-label="Gestion des sources">
        <div className="library-toolbar"><div><h2>Les sources suivies</h2><p>{sources.length} source(s)</p></div><button className="dark-button" onClick={() => setOpen(true)}>＋ Ajouter une source</button></div>
        {loading ? <p role="status" className="list-loading">Chargement des sources…</p> : sources.length ? <div className="source-list">{sources.map(source => <article className="source-row" key={source.id}><span className="avatar">{source.name[0]?.toUpperCase()}</span><div className="source-details"><h3>{source.name}</h3><p>{source.kind === "youtube" ? "YouTube · Vidéos" : source.kind + " · " + source.category}</p></div><div className="source-actions"><button className="outline-button" onClick={() => navigate("all", source.id)}>Voir le flux</button><button className="quiet-button" disabled={refreshing || source.kind !== "youtube"} onClick={() => refresh(source)}>Actualiser</button><a href={source.siteUrl || source.feedUrl} target="_blank" rel="noreferrer" aria-label={"Ouvrir " + source.name}>↗</a><button className="remove-source" aria-label={"Supprimer " + source.name} onClick={() => remove(source)}>×</button></div></article>)}</div> : <div className="dashboard-empty"><span>◉</span><h2>Choisis tes premières sources</h2><p>Suis une chaîne YouTube pour alimenter ta boîte avec ses vidéos.</p><button className="dark-button" onClick={() => setOpen(true)}>Ajouter une source</button></div>}
      </section> : <>
        <div className="feed-overview"><span className="content-type">▷ Vidéos</span><span>{view === "inbox" ? page.counts.inbox + " à découvrir" : page.counts.all + " contenus collectés"}</span><span className="overview-end">Tes flux, sans perdre le fil.</span></div>
        <div className="library-toolbar"><div><h2>{currentSource?.name || "Toutes les sources"}</h2><p>{loading ? "Chargement…" : page.total + " vidéo(s)"}{view === "all" && " · historique collecté"}</p></div><label className="video-search"><span aria-hidden="true">⌕</span><input type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher dans les flux…" aria-label="Rechercher dans les flux" /></label></div>
        <div className="feed-controls"><label>Source<select value={sourceId} onChange={event => { setSourceId(event.target.value); setLoading(true); }}><option value="">Toutes les sources</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label><label>Trier<select value={sort} onChange={event => { setSort(event.target.value); setLoading(true); }}><option value="newest">Plus récentes d’abord</option><option value="oldest">Plus anciennes d’abord</option></select></label>{view === "inbox" && <button className="quiet-button" disabled={changing || loading || !page.items.length} onClick={() => { if (confirm("Archiver les " + page.items.length + " vidéos affichées ? Elles resteront dans la bibliothèque.")) void changeState(page.items.map(item => item.id), { read: true }); }}>✓ Archiver les vidéos affichées</button>}</div>
        {loading ? <div role="status" className="list-loading">Chargement des flux…</div> : page.items.length ? <>
          <div className="video-grid">{page.items.map(item => <article className={"video-card " + (playing?.id === item.id ? "is-playing" : "")} key={item.id}>
            <button className="video-thumb" onClick={() => play(item)} aria-label={"Regarder " + item.title}>{item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" />}<span className="play-icon">▶</span><span className={"watched-badge " + (!item.read ? "unread-badge" : "")}>{item.read ? "✓ Archivée" : "• À découvrir"}</span></button>
            <div className="video-meta"><button className="source-link" onClick={() => navigate("all", item.sourceId)}>{item.sourceName}</button><button className="save-video" disabled={changing} aria-label={(item.saved ? "Retirer des favoris " : "Enregistrer ") + item.title} aria-pressed={item.saved} onClick={() => changeState([item.id], { saved: !item.saved })}>{item.saved ? "♥" : "♡"}</button></div>
            <h3><button onClick={() => play(item)}>{item.title}</button></h3><div className="card-footer"><time dateTime={item.publishedAt || undefined}>{dateLabel(item.publishedAt)}</time><button disabled={changing} onClick={() => changeState([item.id], { read: !item.read })} aria-label={(item.read ? "Remettre dans la boîte " : "Archiver ") + item.title}>{item.read ? "↩ Dans la boîte" : "✓ Archiver"}</button></div>
          </article>)}</div>
          <div className="pagination"><p>{page.items.length} sur {page.total} vidéo(s)</p>{page.nextOffset !== null && <button className="outline-button" disabled={moreLoading || changing} onClick={more}>{moreLoading ? "Chargement…" : "Charger la suite"}</button>}</div>
        </> : <div className="dashboard-empty"><span>{view === "inbox" ? "✓" : "▤"}</span><h2>{!sources.length ? "Tes sources donnent vie à ta boîte" : search || sourceId ? "Aucun contenu pour ces filtres" : view === "inbox" ? "Tu es à jour" : view === "archive" ? "Tes archives commencent ici" : view === "saved" ? "Garde ce qui compte" : "Le premier contenu arrive bientôt"}</h2><p>{!sources.length ? "Ajoute une source vidéo pour recevoir ses nouveautés et commencer ta bibliothèque." : search || sourceId ? "Change de source ou essaie une autre recherche." : view === "inbox" ? "Les prochaines vidéos arriveront ici. Tes anciens contenus restent dans la bibliothèque." : view === "archive" ? "Archive une vidéo une fois traitée : elle quitte la boîte, mais reste accessible ici." : view === "saved" ? "Clique sur le cœur d’un contenu pour le retrouver ici, même après l’avoir archivé." : "Actualise tes sources pour récupérer les vidéos disponibles."}</p>{!sources.length ? <button className="dark-button" onClick={() => setOpen(true)}>Ajouter une source</button> : view === "inbox" && <button className="outline-button" onClick={() => navigate("all")}>Explorer la bibliothèque</button>}</div>}
        {view === "all" && <p className="history-note">La bibliothèque conserve les vidéos récupérées depuis l’ajout de tes sources. Le flux YouTube fournit les publications récentes, pas tout l’historique d’une chaîne.</p>}
      </>}
    </section>
    {open && <AddSource feedUrls={sources.map(source => source.feedUrl)} onClose={() => setOpen(false)} onAdded={message => { setOpen(false); navigate("inbox"); setNotice(message); reload(); }} />}
  </main>;
}
