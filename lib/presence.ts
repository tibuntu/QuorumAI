import { publish, type PresenceEntry, type PresenceCursor, type PresenceSelection, type PresenceScroll } from "@/lib/events";

export type { PresenceEntry, PresenceCursor, PresenceSelection, PresenceScroll };

type Registry = Map<string, Map<string, PresenceEntry>>;

const globalForPresence = globalThis as unknown as {
  presenceRegistry?: Registry;
  presenceSweep?: ReturnType<typeof setInterval>;
};

const registry: Registry = globalForPresence.presenceRegistry ?? new Map();
if (process.env.NODE_ENV !== "production") globalForPresence.presenceRegistry = registry;

/** Upsert the user's presence in a document, bump lastSeen, and broadcast.
 *  Every heartbeat states the full selection, cursor, and scroll truth: an object sets it,
 *  null/undefined clears it (the client owns its selection, cursor, and scroll state). */
export function heartbeat(
  documentId: string,
  user: { userId: string; name: string },
  selection?: PresenceSelection | null,
  cursor?: PresenceCursor | null,
  scroll?: PresenceScroll | null,
): void {
  let docMap = registry.get(documentId);
  if (!docMap) {
    docMap = new Map();
    registry.set(documentId, docMap);
  }
  const entry: PresenceEntry = { userId: user.userId, name: user.name, lastSeen: Date.now() };
  if (selection) entry.selection = selection;
  if (cursor) entry.cursor = cursor;
  if (scroll) entry.scroll = scroll;
  docMap.set(user.userId, entry);
  publish(documentId, { type: "presence.updated", entry });
}

/** Remove a user from a document's roster and broadcast. No-op if absent. */
export function leave(documentId: string, userId: string): void {
  const docMap = registry.get(documentId);
  if (!docMap || !docMap.has(userId)) return;
  docMap.delete(userId);
  if (docMap.size === 0) registry.delete(documentId);
  publish(documentId, { type: "presence.left", userId });
}

/** Current presence entries for a document (empty array when none). */
export function roster(documentId: string): PresenceEntry[] {
  return Array.from(registry.get(documentId)?.values() ?? []);
}

/** Evict entries older than PRESENCE_TTL_MS, broadcasting presence.left for each. */
export function evictStale(): void {
  const ttl = Number(process.env.PRESENCE_TTL_MS ?? 15_000);
  const cutoff = Date.now() - ttl;
  const emptyDocs: string[] = [];
  for (const [documentId, docMap] of registry) {
    const stale: string[] = [];
    for (const [userId, entry] of docMap) {
      if (entry.lastSeen < cutoff) stale.push(userId);
    }
    for (const userId of stale) {
      docMap.delete(userId);
      publish(documentId, { type: "presence.left", userId });
    }
    if (docMap.size === 0) emptyDocs.push(documentId);
  }
  for (const documentId of emptyDocs) registry.delete(documentId);
}

// One process-wide sweep, guarded so dev hot-reload doesn't spawn duplicates.
if (!globalForPresence.presenceSweep) {
  const sweepMs = Number(process.env.PRESENCE_SWEEP_MS ?? 10_000);
  const timer = setInterval(evictStale, sweepMs);
  timer.unref?.(); // never keep the process (or a test runner) alive for the sweep
  globalForPresence.presenceSweep = timer;
}
