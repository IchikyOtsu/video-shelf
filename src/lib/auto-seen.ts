export type TimerScheduler = {
  set(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout>): void;
};

const browserTimer: TimerScheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: timer => clearTimeout(timer),
};

export function scheduleAutoSeen(onSeen: () => void, scheduler = browserTimer, delay = 30_000) {
  const timer = scheduler.set(onSeen, delay);
  return () => scheduler.clear(timer);
}
