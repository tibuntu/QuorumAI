export type ThemeChoice = "light" | "dark" | "system";
export const STORAGE_KEY = "quorum-theme";

/** Pure: given a choice and the OS dark preference, should `.dark` be applied? */
export function resolveDark(choice: ThemeChoice, prefersDark: boolean): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return prefersDark;
}

export const THEME_OPTIONS: ThemeChoice[] = ["light", "dark", "system"];

// Shared external store over the persisted theme choice. Both ThemeToggle (which
// writes) and consumers like DocumentEditor (which read reactively) subscribe to
// the same store so there is a single client-side source of truth.
const themeListeners = new Set<() => void>();
export function emitThemeChange(): void {
  themeListeners.forEach((l) => l());
}
export function subscribeTheme(cb: () => void): () => void {
  themeListeners.add(cb);
  return () => {
    themeListeners.delete(cb);
  };
}
export function getChoice(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
  return stored && THEME_OPTIONS.includes(stored) ? stored : "system";
}

/** Apply the resolved `.dark` class for a given choice based on the live OS preference. */
export function applyTheme(choice: ThemeChoice): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", resolveDark(choice, prefersDark));
}

/** Inline boot script (runs before paint) — single source of truth for class application. */
export const THEME_SCRIPT = `(function(){try{
var c=localStorage.getItem('${STORAGE_KEY}')||'system';
var d=c==='dark'||(c==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark', d);
}catch(e){}})();`;
