import { subscribe as busSubscribe, type DocEvent } from "@/lib/events";
import { getPlanFeedback } from "@/lib/feedback";

/** Events that wake a waiter: a decision/state transition or a new version while pending. */
const WAKE_EVENTS = new Set<DocEvent["type"]>(["review.updated", "version.created"]);

/** Snapshot shape returned by getPlanFeedback (non-null) plus the long-poll flag. */
type Snapshot = NonNullable<Awaited<ReturnType<typeof getPlanFeedback>>>;
export type WaitResult = (Snapshot & { timedOut: boolean }) | null;

export interface WaitDeps {
  subscribe?: typeof busSubscribe;
  readSnapshot?: (documentId: string) => Promise<Snapshot | null>;
}

/** Clamp a client-requested timeout into (0, max], falling back to min(default, max) when absent/invalid. */
export function clampTimeout(requested: number | undefined, max: number, dflt: number): number {
  if (requested === undefined || Number.isNaN(requested) || requested <= 0) return Math.min(dflt, max);
  return Math.min(requested, max);
}

/**
 * Hold until the plan's decision/state changes or `timeoutMs` elapses.
 *
 * Order matters: we subscribe FIRST, then re-check the DB, so a decision that
 * landed between the caller's last poll and this connect is caught by the
 * re-check rather than missed (spec D2). Returns null when the doc is gone.
 */
export async function waitForFeedbackChange(documentId: string, timeoutMs: number, deps: WaitDeps = {}): Promise<WaitResult> {
  const subscribe = deps.subscribe ?? busSubscribe;
  const readSnapshot = deps.readSnapshot ?? getPlanFeedback;

  let fired = false;
  let resolveEvent!: () => void;
  const eventPromise = new Promise<void>((resolve) => { resolveEvent = resolve; });
  const handler = (e: DocEvent) => {
    if (WAKE_EVENTS.has(e.type)) { fired = true; resolveEvent(); }
  };
  const unsubscribe = subscribe(documentId, handler);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // On-connect re-check closes the poll<->connect race.
    const initial = await readSnapshot(documentId);
    if (initial === null) return null;
    if (initial.decision !== "pending") return { ...initial, timedOut: false };

    const timeoutPromise = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    await Promise.race([eventPromise, timeoutPromise]);

    const snapshot = await readSnapshot(documentId);
    if (snapshot === null) return null;
    return { ...snapshot, timedOut: !fired };
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}
