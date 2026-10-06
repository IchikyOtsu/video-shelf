"use client";
import { useEffect, useRef, useState } from "react";
import { formatDuration, playbackIsComplete, ProgressSaveQueue, PROGRESS_SAMPLE_INTERVAL_MS, resumePosition } from "@/lib/playback";

type PlayerEvent = { target: YouTubePlayer; data: number };
type YouTubePlayer = {
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
};
type YouTubeNamespace = {
  Player: new (element: HTMLElement, options: { host?: string; videoId: string; playerVars: Record<string, number | string>; events: { onReady(event: PlayerEvent): void; onStateChange(event: PlayerEvent): void; onError(): void } }) => YouTubePlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.onYouTubeIframeAPIReady = previous;
      previous?.();
      if (window.YT) resolve(window.YT); else reject(new Error("YouTube Player API unavailable"));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) return;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      window.onYouTubeIframeAPIReady = previous;
      youtubeApiPromise = null;
      reject(new Error("YouTube Player API unavailable"));
    };
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

export function YouTubePlayer({ itemId, videoId, initialProgress, initialDuration, suppressAutoSeen, onProgress, onComplete, onWarning }: {
  itemId: string;
  videoId: string;
  initialProgress: number;
  initialDuration: number | null;
  suppressAutoSeen: boolean;
  onProgress(progressSeconds: number, durationSeconds: number | null, lastPlayedAt: string): void;
  onComplete(): boolean | Promise<boolean>;
  onWarning(message: string): void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const saver = useRef<ProgressSaveQueue | null>(null);
  const latest = useRef({ progressSeconds: initialProgress, durationSeconds: initialDuration as number | null });
  const warned = useRef(false);
  const completionReported = useRef(false);
  const initialProgressRef = useRef(initialProgress);
  const initialDurationRef = useRef(initialDuration);
  const suppressRef = useRef(suppressAutoSeen);
  const progressCallback = useRef(onProgress);
  const completeCallback = useRef(onComplete);
  const warningCallback = useRef(onWarning);
  const [position, setPosition] = useState(initialProgress);
  const [duration, setDuration] = useState(initialDuration);
  useEffect(() => { suppressRef.current = suppressAutoSeen; }, [suppressAutoSeen]);
  useEffect(() => { progressCallback.current = onProgress; }, [onProgress]);
  useEffect(() => { completeCallback.current = onComplete; }, [onComplete]);
  useEffect(() => { warningCallback.current = onWarning; }, [onWarning]);

  useEffect(() => {
    let cancelled = false;
    function stopSampling() {
      if (interval.current) clearInterval(interval.current);
      interval.current = null;
    }
    function reportFailure() {
      if (warned.current) return;
      warned.current = true;
      warningCallback.current("La lecture continue. La progression sera réessayée automatiquement.");
    }
    saver.current = new ProgressSaveQueue(async (sample, keepalive) => {
      const response = await fetch("/api/items/progress", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, keepalive,
        body: JSON.stringify({ itemId, ...sample }),
      });
      if (!response.ok) throw new Error("Progress save failed");
      warned.current = false;
    }, initialProgressRef.current);
    function sample(target: YouTubePlayer, force = false, keepalive = false, ended = false) {
      const rawProgress = ended ? target.getDuration() : target.getCurrentTime();
      const rawDuration = target.getDuration();
      if (!Number.isFinite(rawProgress) || rawProgress < 0) return;
      const progressSeconds = Math.max(0, Math.floor(rawProgress));
      const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.floor(rawDuration) : latest.current.durationSeconds;
      const observedAt = Date.now();
      latest.current = { progressSeconds, durationSeconds };
      setPosition(progressSeconds); setDuration(durationSeconds);
      progressCallback.current(progressSeconds, durationSeconds, new Date(observedAt).toISOString());
      saver.current?.observe(progressSeconds, durationSeconds, observedAt);
      if (force) void saver.current?.persist(true, keepalive).catch(reportFailure);
      else void saver.current?.persist().catch(reportFailure);
      if (!completionReported.current && playbackIsComplete(progressSeconds, durationSeconds, ended, suppressRef.current)) {
        completionReported.current = true;
        void Promise.resolve(completeCallback.current()).then(accepted => { if (!accepted) completionReported.current = false; });
      }
    }
    function startSampling(target: YouTubePlayer) {
      stopSampling();
      sample(target);
      interval.current = setInterval(() => sample(target), PROGRESS_SAMPLE_INTERVAL_MS);
    }
    function flushOnExit() { if (player.current) sample(player.current, true, true); }
    window.addEventListener("pagehide", flushOnExit);
    void loadYouTubeApi().then(YT => {
      if (cancelled || !mount.current) return;
      const instance = new YT.Player(mount.current, {
        host: "https://www.youtube-nocookie.com", videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1, origin: window.location.origin },
        events: {
          onReady(event) {
            if (cancelled) return;
            const playerDuration = event.target.getDuration();
            const knownDuration = playerDuration > 0 ? Math.floor(playerDuration) : initialDurationRef.current;
            const start = resumePosition(initialProgressRef.current, knownDuration);
            latest.current = { progressSeconds: start, durationSeconds: knownDuration };
            setPosition(start); setDuration(knownDuration);
            if (start > 0) event.target.seekTo(start, true);
            event.target.playVideo();
          },
          onStateChange(event) {
            if (cancelled) return;
            if (event.data === YT.PlayerState.PLAYING) startSampling(event.target);
            else if (event.data === YT.PlayerState.PAUSED) { stopSampling(); sample(event.target, true); }
            else if (event.data === YT.PlayerState.ENDED) { stopSampling(); sample(event.target, true, false, true); }
            else stopSampling();
          },
          onError() { if (!cancelled) warningCallback.current("Cette vidéo ne peut pas être lue ici. Ouvre-la sur YouTube."); },
        },
      });
      player.current = instance;
    }).catch(() => { if (!cancelled) warningCallback.current("Le lecteur YouTube n’a pas pu être chargé."); });
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", flushOnExit);
      stopSampling();
      if (player.current) sample(player.current, true, true);
      player.current?.destroy();
      player.current = null;
    };
  }, [itemId, videoId]);

  return <div className="youtube-player-shell"><div className="youtube-player-frame"><div ref={mount} className="youtube-player" /></div><p className="playback-time">{position > 0 ? "Lecture " : "Début · "}{formatDuration(position)}{duration ? " / " + formatDuration(duration) : ""}</p></div>;
}
