"use client";
import { useEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  emitThemeChange,
  getChoice,
  STORAGE_KEY,
  subscribeTheme,
  THEME_OPTIONS,
  type ThemeChoice,
} from "@/lib/theme";

const LABEL: Record<ThemeChoice, string> = { light: "☀", dark: "☾", system: "⌖" };

export function ThemeToggle() {
  // useSyncExternalStore renders the server snapshot ("system") during hydration,
  // then the client value — no setState-in-effect and no hydration mismatch.
  const choice = useSyncExternalStore(subscribeTheme, getChoice, () => "system");

  // While in system, keep the class in sync with live OS preference changes.
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  function pick(next: ThemeChoice) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
    emitThemeChange();
  }

  return (
    <div className="flex items-center gap-1" data-testid="theme-toggle" role="group" aria-label="Theme">
      {THEME_OPTIONS.map((o) => (
        <button
          key={o}
          type="button"
          data-testid={`theme-${o}`}
          aria-pressed={choice === o}
          onClick={() => pick(o)}
          title={o}
          className={`rounded px-2 py-1 text-sm ${choice === o ? "bg-primary-subtle text-foreground" : "text-muted hover:text-foreground"}`}
        >
          {LABEL[o]}
        </button>
      ))}
    </div>
  );
}
