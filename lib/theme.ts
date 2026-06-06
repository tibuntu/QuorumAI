export type ThemeChoice = "light" | "dark" | "system";
export const STORAGE_KEY = "quorum-theme";

/** Pure: given a choice and the OS dark preference, should `.dark` be applied? */
export function resolveDark(choice: ThemeChoice, prefersDark: boolean): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return prefersDark;
}

/** Inline boot script (runs before paint) — single source of truth for class application. */
export const THEME_SCRIPT = `(function(){try{
var c=localStorage.getItem('${STORAGE_KEY}')||'system';
var d=c==='dark'||(c==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark', d);
}catch(e){}})();`;
