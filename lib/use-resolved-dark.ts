"use client";
import { useSyncExternalStore } from "react";
import { getChoice, resolveDark, subscribeTheme, type ThemeChoice } from "@/lib/theme";

// Bridges the OS prefers-color-scheme media query into a subscribe/getSnapshot
// pair so a single useSyncExternalStore tracks both the persisted choice (via the
// shared theme store) and live OS preference changes.
function subscribePrefersDark(cb: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function getPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Reactively resolve whether the app is in dark mode, reusing the shared theme
 * store written by ThemeToggle. Reacts to live theme toggles and OS changes with
 * no reload. Returns `false` on the server / first hydration snapshot.
 */
export function useResolvedDark(): boolean {
  const choice = useSyncExternalStore<ThemeChoice>(subscribeTheme, getChoice, () => "system");
  const prefersDark = useSyncExternalStore(subscribePrefersDark, getPrefersDark, () => false);

  return resolveDark(choice, prefersDark);
}
