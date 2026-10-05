"use client";

import { useSyncExternalStore } from "react";
import { parseThemePreference, themeStorageKey } from "@/lib/theme";

const changedEvent = "shelf-theme-changed";
function snapshot() { return parseThemePreference(document.documentElement.dataset.theme); }
function serverSnapshot() { return "system" as const; }
function subscribe(notify: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    document.documentElement.dataset.theme = parseThemePreference(event.newValue);
    notify();
  };
  window.addEventListener(changedEvent, notify);
  window.addEventListener("storage", storageChanged);
  return () => {
    window.removeEventListener(changedEvent, notify);
    window.removeEventListener("storage", storageChanged);
  };
}

export function ThemeSetting() {
  const theme = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <section className="theme-setting">
    <h3>Apparence</h3>
    <label htmlFor="shelf-theme">Thème</label>
    <select id="shelf-theme" value={theme} onChange={event => {
      const value = parseThemePreference(event.target.value);
      document.documentElement.dataset.theme = value;
      try { localStorage.setItem(themeStorageKey, value); } catch { /* The choice still works for this visit. */ }
      window.dispatchEvent(new Event(changedEvent));
    }}>
      <option value="system">Système (thème du navigateur)</option>
      <option value="light">Clair</option>
      <option value="dark">Sombre</option>
    </select>
    <p>Le mode système suit automatiquement le thème de votre navigateur. Votre choix est conservé sur cet appareil.</p>
  </section>;
}
