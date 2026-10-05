"use client";
import { useEffect, useRef, useState } from "react";
import { createAudioPlayback } from "@/lib/audio-playback";
import { formatDuration } from "@/lib/playback";

export function PodcastPlayer({ itemId, audioUrl, initialProgress, initialDuration, suppressAutoSeen, onStart, onProgress, onComplete, onWarning }: {
  itemId: string; audioUrl: string; initialProgress: number; initialDuration: number | null; suppressAutoSeen: boolean;
  onProgress(progress: number, duration: number | null, at: string): void;
  onStart(): boolean | Promise<boolean>;
  onComplete(): boolean | Promise<boolean>; onWarning(message: string): void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const callbacks = useRef({ onStart, onProgress, onComplete, onWarning, suppressAutoSeen });
  const started = useRef(false);
  const initial = useRef({ initialProgress, initialDuration });
  const [position, setPosition] = useState(initialProgress);
  const [duration, setDuration] = useState(initialDuration);
  const [failed, setFailed] = useState(false);
  useEffect(() => { callbacks.current = { onStart, onProgress, onComplete, onWarning, suppressAutoSeen }; }, [onStart, onProgress, onComplete, onWarning, suppressAutoSeen]);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const playback = createAudioPlayback({
      ...initial.current, requirePlaybackStart:true,
      write: async (sample, keepalive) => {
        const response = await fetch("/api/items/progress", { method: "PATCH", headers: { "Content-Type": "application/json" }, keepalive, body: JSON.stringify({ itemId, ...sample }) });
        if (!response.ok) throw new Error("Progress save failed");
      },
      progress: (seconds, length, at) => { setPosition(seconds); setDuration(length); callbacks.current.onProgress(seconds, length, at); },
      complete: () => callbacks.current.onComplete(), suppressed: () => callbacks.current.suppressAutoSeen,
      warning: () => callbacks.current.onWarning("La progression sera réessayée automatiquement."),
    });
    const loaded = () => { try { playback.loaded(element); setPosition(element.currentTime); setDuration(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : initial.current.initialDuration); } catch { /* Retry seeking when canplay fires. */ } };
    const play = () => {
      playback.start();
      if (started.current) return;
      started.current = true;
      void Promise.resolve().then(() => callbacks.current.onStart()).then(accepted => { if (!accepted) started.current = false; }).catch(() => { started.current = false; callbacks.current.onWarning("Le statut de lecture sera réessayé."); });
    };
    const sample = () => playback.sample(element);
    const flush = () => playback.sample(element, true);
    const exit = () => playback.sample(element, true, true);
    const ended = () => playback.sample(element, true, false, true);
    element.addEventListener("loadedmetadata", loaded); element.addEventListener("canplay", loaded);
    element.addEventListener("play", play); element.addEventListener("timeupdate", sample); element.addEventListener("pause", flush); element.addEventListener("seeked", flush); element.addEventListener("ended", ended);
    window.addEventListener("pagehide", exit);
    if (element.readyState >= 1) loaded();
    return () => {
      exit();
      element.removeEventListener("loadedmetadata", loaded); element.removeEventListener("canplay", loaded);
      element.removeEventListener("play", play); element.removeEventListener("timeupdate", sample); element.removeEventListener("pause", flush); element.removeEventListener("seeked", flush); element.removeEventListener("ended", ended);
      window.removeEventListener("pagehide", exit);
    };
  }, [itemId, audioUrl]);
  return <div className="podcast-player"><audio ref={audio} src={audioUrl} controls preload="metadata" aria-label="Lecteur du podcast" onError={() => setFailed(true)} /><p className="playback-time">{formatDuration(position)}{duration ? " / " + formatDuration(duration) : ""}</p>{failed && <p role="alert" className="player-fallback">L’audio ne peut pas être lu ici. Ouvre l’épisode sur le site de la source.</p>}</div>;
}
