"use client";
/* Only server-sanitized HTML is rendered; feed images stay external. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { FeedItem } from "@/lib/library";
import type { ReaderContent } from "@/lib/reader-content";
import { request } from "@/lib/client";
import { safeMediaUrl } from "@/lib/item-opening";
import { ProgressSaveQueue } from "@/lib/playback";
import { defaultReaderPreferences, parseReaderPreferences, readingIsComplete, readingPercent, resumeReadingPercent, type ReaderPreferences } from "@/lib/reading";

type Props = { item: FeedItem; suppressAutoSeen: boolean; onStart(): boolean | Promise<boolean>; onProgress(progress: number, duration: number | null, at: string): void; onComplete(): boolean | Promise<boolean>; onWarning(message: string): void };
export function ArticleReader({ item, suppressAutoSeen, onStart, onProgress, onComplete, onWarning }: Props) {
  const [content, setContent] = useState<ReaderContent | null>(null);
  const [failed, setFailed] = useState(false);
  const [failedImage, setFailedImage] = useState(false);
  const [preferences, setPreferences] = useState(() => {
    if (typeof window === "undefined") return defaultReaderPreferences;
    try { return parseReaderPreferences(JSON.parse(localStorage.getItem("shelf-reader") || "null")); } catch { return defaultReaderPreferences; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [percent, setPercent] = useState(() => resumeReadingPercent(item.progressSeconds, item.read));
  const scroller = useRef<HTMLDivElement>(null);
  const layoutPosition = useRef<number | null>(null);
  const initial = useRef(resumeReadingPercent(item.progressSeconds, item.read));
  const callbacks = useRef({ suppressAutoSeen, onStart, onProgress, onComplete, onWarning });
  useEffect(() => { callbacks.current = { suppressAutoSeen, onStart, onProgress, onComplete, onWarning }; }, [suppressAutoSeen, onStart, onProgress, onComplete, onWarning]);
  useEffect(() => {
    const controller = new AbortController();
    void request(`/api/items/${item.id}/content`, { signal:controller.signal }).then((data: ReaderContent) => { if (!controller.signal.aborted) setContent(data); }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [item.id]);
  useEffect(() => {
    const element = scroller.current;
    if (!element || !content?.html) return;
    let lastPublished = initial.current;
    let frame = 0;
    let active = false, started = false, starting = false, completing = false, attentiveSeconds = 0;
    const saver = new ProgressSaveQueue(async (sample, keepalive) => {
      const response = await fetch("/api/items/progress", { method:"PATCH", headers:{"Content-Type":"application/json"}, keepalive, body:JSON.stringify({ itemId:item.id, ...sample }) });
      if (!response.ok) throw new Error("READING_SAVE_FAILED");
    }, initial.current);
    const restore = () => { if (!active) element.scrollTop = initial.current / 100 * Math.max(0, element.scrollHeight - element.clientHeight); };
    restore();
    const resize = new ResizeObserver(restore); resize.observe(element); if (element.firstElementChild) resize.observe(element.firstElementChild);
    const begin = () => {
      active = true;
      if (started || starting) return;
      starting = true;
      void Promise.resolve().then(() => callbacks.current.onStart()).then(accepted => { started = accepted; }).catch(() => callbacks.current.onWarning("Le statut de lecture sera réessayé.")).finally(() => { starting = false; });
    };
    const sample = (force = false, keepalive = false) => {
      if (!active || element.clientHeight <= 0) return;
      const progress = readingPercent(element.scrollTop, element.scrollHeight, element.clientHeight);
      const now = Date.now();
      if (progress !== lastPublished || force) { lastPublished = progress; setPercent(progress); callbacks.current.onProgress(progress, 100, new Date(now).toISOString()); }
      saver.observe(progress, 100, now);
      void saver.persist(force, keepalive).catch(() => callbacks.current.onWarning("La progression de lecture sera réessayée automatiquement."));
      if (started && !completing && readingIsComplete(progress, attentiveSeconds, content.kind === "full", callbacks.current.suppressAutoSeen)) {
        completing = true;
        void Promise.resolve().then(() => callbacks.current.onComplete()).then(accepted => { if (!accepted) completing = false; }).catch(() => { completing = false; });
      }
    };
    const scroll = () => { if (active && !frame) frame = requestAnimationFrame(() => { frame = 0; sample(); }); };
    const interact = (event: Event) => { if (event.isTrusted) begin(); };
    const hide = () => sample(true, true);
    const visibility = () => { if (document.hidden) hide(); };
    // Restoring scroll position does not start a new reading session.
    element.addEventListener("pointerdown", interact); element.addEventListener("wheel", interact, { passive:true }); element.addEventListener("keydown", interact); element.addEventListener("touchstart", interact, { passive:true }); element.addEventListener("scroll", scroll);
    const timer = setInterval(() => { if (active && !document.hidden && document.hasFocus()) { attentiveSeconds += 2; if (!started) begin(); sample(); } }, 2_000);
    window.addEventListener("pagehide", hide); document.addEventListener("visibilitychange", visibility);
    return () => { void saver.persist(true, true).catch(() => callbacks.current.onWarning("La progression de lecture n’a pas été enregistrée.")); cancelAnimationFrame(frame); clearInterval(timer); resize.disconnect(); window.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", visibility); element.removeEventListener("pointerdown", interact); element.removeEventListener("wheel", interact); element.removeEventListener("keydown", interact); element.removeEventListener("touchstart", interact); element.removeEventListener("scroll", scroll); };
  }, [item.id, content]);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && layoutPosition.current !== null) { element.scrollTop = layoutPosition.current / 100 * Math.max(0, element.scrollHeight - element.clientHeight); layoutPosition.current = null; }
  }, [preferences]);
  function configure(next: ReaderPreferences) {
    const element = scroller.current;
    const position = element ? readingPercent(element.scrollTop, element.scrollHeight, element.clientHeight) : 0;
    layoutPosition.current = position;
    setPreferences(next);
    try { localStorage.setItem("shelf-reader", JSON.stringify(next)); } catch { /* Apply for this visit. */ }
  }
  const parsedDate = item.publishedAt ? new Date(item.publishedAt) : null;
  const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? new Intl.DateTimeFormat("fr-BE", { dateStyle:"long" }).format(parsedDate) : "";
  const image = safeMediaUrl(item.imageUrl);
  return <article className="article-reader-shell" style={{ "--reader-size":preferences.size + "px", "--reader-font":preferences.font === "sans" ? "Arial, Helvetica, sans-serif" : "Georgia, serif", "--reader-width":preferences.width === "wide" ? "900px" : "680px" } as CSSProperties}>
    <div className="reader-toolbar"><span>{percent}% lu</span><button className="outline-button" aria-expanded={settingsOpen} aria-controls="reader-settings" onClick={() => setSettingsOpen(value => !value)}>Aa <span>Lecture</span></button></div>
    {settingsOpen && <div id="reader-settings" className="reader-settings">
      <label>Taille du texte <span>{preferences.size}px</span><input type="range" min={16} max={24} value={preferences.size} onChange={event => configure({ ...preferences, size:Number(event.target.value) })} /></label>
      <label>Police<select value={preferences.font} onChange={event => configure({ ...preferences, font:event.target.value === "sans" ? "sans" : "serif" })}><option value="serif">Avec empattements</option><option value="sans">Sans empattements</option></select></label>
      <label>Largeur<select value={preferences.width} onChange={event => configure({ ...preferences, width:event.target.value === "wide" ? "wide" : "comfortable" })}><option value="comfortable">Confortable</option><option value="wide">Large</option></select></label>
    </div>}
    <div className="reader-scroll" ref={scroller} tabIndex={0} aria-label="Contenu de l’article"><div className="article-reader">
      <header><p className="eyebrow">{item.sourceName}</p><h2>{item.title}</h2><p className="reader-byline">{item.author && <span>{item.author}</span>}{date && <time dateTime={item.publishedAt!}>{date}</time>}{item.readingMinutes && <span>≈ {item.readingMinutes} min</span>}</p></header>
      {image && !failedImage && <img className="reader-cover" src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(true)} />}
      {!content && !failed && <p role="status">Chargement de l’article…</p>}
      {(failed || content?.kind === "missing") && <p className="reader-notice">Le flux ne fournit pas de contenu lisible. Ouvre l’article sur le site de la source.</p>}
      {content?.kind === "summary" && <p className="reader-notice">Cet extrait est fourni par le flux. Lis l’article complet sur le site de la source.</p>}
      {content?.html && <div className="reader-prose" dangerouslySetInnerHTML={{ __html:content.html }} />}
      <a className="reader-source-link" href={safeMediaUrl(item.url) || undefined} target="_blank" rel="noopener noreferrer">Lire sur le site de la source ↗</a>
    </div></div>
    <div className="reader-progress" role="progressbar" aria-label="Progression de lecture" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width:percent + "%" }} /></div>
  </article>;
}
