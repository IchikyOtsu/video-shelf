export type ReaderPreferences = { size: number; font: "serif" | "sans"; width: "comfortable" | "wide" };
export const defaultReaderPreferences: ReaderPreferences = { size:18, font:"serif", width:"comfortable" };
export function parseReaderPreferences(value: unknown): ReaderPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { size: typeof input.size === "number" && Number.isFinite(input.size) ? Math.min(24, Math.max(16, Math.round(input.size))) : 18,
    font: input.font === "sans" ? "sans" : "serif", width: input.width === "wide" ? "wide" : "comfortable" };
}
export function readingPercent(scrollTop: number, scrollHeight: number, clientHeight: number) {
  const distance = scrollHeight - clientHeight;
  return distance <= 1 ? 100 : Math.round(Math.min(1, Math.max(0, scrollTop / distance)) * 100);
}
export function resumeReadingPercent(progress: number, read: boolean) {
  return read || !Number.isFinite(progress) || progress >= 95 ? 0 : Math.max(0, Math.min(100, Math.floor(progress)));
}
export function readingIsComplete(percent: number, attentiveSeconds: number, fullContent: boolean, suppressed: boolean) {
  return fullContent && !suppressed && percent >= 90 && attentiveSeconds >= 10;
}
