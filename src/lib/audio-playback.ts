import { playbackIsComplete, ProgressSaveQueue, resumePosition, type ProgressSample } from "./playback";
export type AudioPosition = { currentTime: number; duration: number };
export function createAudioPlayback(options: {
  requirePlaybackStart?: boolean;
  initialProgress: number; initialDuration: number | null;
  write(sample: ProgressSample, keepalive: boolean): Promise<void>;
  progress(progress: number, duration: number | null, at: string): void;
  complete(): boolean | Promise<boolean>; suppressed(): boolean; warning(): void;
}) {
  const saver = new ProgressSaveQueue(options.write, options.initialProgress);
  let started = !options.requirePlaybackStart;
  let ready = false; let completing = false; let knownDuration = options.initialDuration;
  const duration = (audio: AudioPosition) => Number.isFinite(audio.duration) && audio.duration > 0 ? Math.floor(audio.duration) : knownDuration;
  return {
    start() { started = true; },
    loaded(audio: AudioPosition) {
      if (ready) return;
      knownDuration = duration(audio);
      audio.currentTime = resumePosition(options.initialProgress, knownDuration);
      ready = true;
    },
    sample(audio: AudioPosition, force = false, keepalive = false, ended = false) {
      if (!ready || !started || !Number.isFinite(audio.currentTime) || audio.currentTime < 0) return;
      knownDuration = duration(audio);
      const seconds = Math.floor(ended && knownDuration ? knownDuration : audio.currentTime);
      const at = Date.now();
      options.progress(seconds, knownDuration, new Date(at).toISOString());
      saver.observe(seconds, knownDuration, at);
      void saver.persist(force, keepalive).catch(options.warning);
      if (!completing && playbackIsComplete(seconds, knownDuration, ended, options.suppressed())) {
        completing = true;
        void Promise.resolve().then(options.complete).then(accepted => { if (!accepted) completing = false; }).catch(() => { completing = false; options.warning(); });
      }
    },
  };
}
