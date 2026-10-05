import { uuidPattern } from "./library";

export const COMPLETION_THRESHOLD = 0.9;
export const RESUME_RESET_THRESHOLD = 0.95;
export const PROGRESS_SAVE_INTERVAL_MS = 10_000;
export const PROGRESS_SAMPLE_INTERVAL_MS = 2_000;
export const MIN_PROGRESS_DELTA_SECONDS = 3;
export const MAX_MEDIA_DURATION_SECONDS = 24 * 60 * 60;

export type ProgressUpdate = {
  itemId: string;
  progressSeconds: number;
  durationSeconds: number | null;
  observedAt: number;
};

export class ProgressValidationError extends Error {}
export class ProgressAccessError extends Error {}

export function parseProgressUpdate(body: unknown, now = Date.now()): ProgressUpdate {
  if (!body || typeof body !== "object") throw new ProgressValidationError("Progression invalide.");
  const value = body as Record<string, unknown>;
  const itemId = typeof value.itemId === "string" ? value.itemId : "";
  const progress = value.progressSeconds;
  const duration = value.durationSeconds;
  const observed = value.observedAt === undefined ? now : value.observedAt;
  if (!uuidPattern.test(itemId) || typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > MAX_MEDIA_DURATION_SECONDS + 60 ||
    (duration !== undefined && duration !== null && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_MEDIA_DURATION_SECONDS)) ||
    typeof observed !== "number" || !Number.isFinite(observed) || observed <= 0 || observed > now + 5 * 60_000) throw new ProgressValidationError("Progression invalide.");
  const durationSeconds = duration == null ? null : Math.floor(duration);
  if (durationSeconds !== null && progress > durationSeconds + 60) throw new ProgressValidationError("Progression invalide.");
  return {
    itemId,
    progressSeconds: durationSeconds === null ? Math.floor(progress) : Math.min(Math.floor(progress), durationSeconds),
    durationSeconds,
    observedAt: Math.floor(observed),
  };
}

export async function processProgressUpdate(
  body: unknown,
  ownsItem: (itemId: string) => Promise<boolean>,
  persist: (update: ProgressUpdate) => Promise<void>,
  now = Date.now(),
) {
  const update = parseProgressUpdate(body, now);
  if (!await ownsItem(update.itemId)) throw new ProgressAccessError("Contenu introuvable.");
  await persist(update);
  return update;
}

export function resumePosition(progressSeconds: number, durationSeconds: number | null) {
  if (!Number.isFinite(progressSeconds) || progressSeconds <= 0) return 0;
  if (durationSeconds && (progressSeconds / durationSeconds >= RESUME_RESET_THRESHOLD || durationSeconds - progressSeconds <= 10)) return 0;
  return Math.floor(progressSeconds);
}

export function playbackIsComplete(progressSeconds: number, durationSeconds: number | null, ended = false, manualNewOverride = false) {
  if (manualNewOverride) return false;
  if (ended) return true;
  return Boolean(durationSeconds && durationSeconds > 0 && progressSeconds / durationSeconds >= COMPLETION_THRESHOLD);
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export type ProgressSample = Omit<ProgressUpdate, "itemId">;

export class ProgressSaveQueue {
  private latest: ProgressSample | null = null;
  private lastQueuedAt = Number.NEGATIVE_INFINITY;
  private lastQueuedProgress: number;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly writer: (sample: ProgressSample, keepalive: boolean) => Promise<void>,
    initialProgress = 0,
    private readonly intervalMs = PROGRESS_SAVE_INTERVAL_MS,
    private readonly minimumDelta = MIN_PROGRESS_DELTA_SECONDS,
  ) { this.lastQueuedProgress = initialProgress; }

  observe(progressSeconds: number, durationSeconds: number | null, observedAt = Date.now()) {
    this.latest = { progressSeconds: Math.max(0, Math.floor(progressSeconds)), durationSeconds: durationSeconds && durationSeconds > 0 ? Math.floor(durationSeconds) : null, observedAt };
  }

  persist(force = false, keepalive = false) {
    const sample = this.latest;
    if (!sample || (!force && (sample.observedAt - this.lastQueuedAt < this.intervalMs || Math.abs(sample.progressSeconds - this.lastQueuedProgress) < this.minimumDelta))) return Promise.resolve(false);
    this.lastQueuedAt = sample.observedAt;
    this.lastQueuedProgress = sample.progressSeconds;
    const operation = this.tail.then(() => this.writer(sample, keepalive));
    this.tail = operation.catch(() => undefined);
    return operation.then(() => true);
  }
}
