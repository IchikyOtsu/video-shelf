export type ThemePreference = "system" | "light" | "dark";
export const themeStorageKey = "shelf-theme";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

// Runs before the page is painted. The value is restricted to known themes.
export const themeBootstrap = `try { var theme = localStorage.getItem("${themeStorageKey}"); document.documentElement.dataset.theme = theme === "light" || theme === "dark" ? theme : "system"; } catch { document.documentElement.dataset.theme = "system"; }`;
