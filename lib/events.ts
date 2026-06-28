import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";

export interface ClientNotification {
  id: string;
  type: string; // "comment" | "review" | "version" | "resolve" (see notifications.ts)
  documentId: string;
  documentTitle: string;
  actorId: string | null;
  actorName?: string | null;
  read: boolean;
  createdAt: string; // ISO
}

export interface PresenceSelection {
  start: number; // offset into the rendered container's textContent
  end: number; // exclusive; start < end
  versionNumber: number; // document version the offsets were measured against
}

export interface PresenceCursor {
  x: number; // 0..1 fraction of the doc-body box width
  y: number; // 0..1 fraction of the doc-body box height
}

export interface PresenceScroll {
  y: number; // 0..1 fraction of the doc-body box height (leader viewport-top position)
}

export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number; // epoch ms
  selection?: PresenceSelection; // absent when nothing selected
  cursor?: PresenceCursor; // absent when the pointer is outside the doc body
  scroll?: PresenceScroll; // present only while this user is a session leader broadcasting scroll
}

export interface SessionParticipant {
  userId: string;
  name: string;
  joinedAt: number; // epoch ms
}

export interface ReviewSession {
  sessionId: string; // crypto.randomUUID()
  documentId: string;
  leaderId: string;
  leaderName: string;
  participants: SessionParticipant[]; // includes the leader; ordered by joinedAt
  startedAt: number; // epoch ms
}

export type DocEvent =
  | { type: "annotation.created"; annotation: unknown }
  | { type: "comment.created"; annotationId: string; comment: unknown }
  | { type: "annotation.updated"; annotationId: string; status?: string; threadStatus?: string }
  | { type: "review.updated"; state: string }
  | { type: "version.created"; versionNumber: number; summary: unknown }
  | { type: "notification.created"; notification: ClientNotification }
  | { type: "notification.read"; id: string }
  | { type: "notification.read.all" }
  | { type: "presence.sync"; roster: PresenceEntry[] }
  | { type: "presence.updated"; entry: PresenceEntry }
  | { type: "presence.left"; userId: string }
  | { type: "session.started"; session: ReviewSession }
  | { type: "session.updated"; session: ReviewSession }
  | { type: "session.ended" };

// ---------------------------------------------------------------------------
// Cross-replica event bus.
//
// The public API (publish/subscribe) is unchanged. Under the hood there are two
// backends, chosen by DATABASE_URL: an in-process EventEmitter (SQLite /
// single-instance) and a Postgres LISTEN/NOTIFY backend that fans events out
// across replicas (active-active). Callers — SSE routes, feedback-wait, presence,
// review-session — never see the difference.
// ---------------------------------------------------------------------------

interface EventBus {
  publish(key: string, event: DocEvent): void;
  subscribe(key: string, handler: (e: DocEvent) => void): () => void;
}

// In-process delivery. Used directly for SQLite, and as the local-delivery layer
// inside the Postgres backend.
class LocalBus implements EventBus {
  readonly emitter: EventEmitter;
  constructor(emitter?: EventEmitter) {
    this.emitter = emitter ?? new EventEmitter();
    this.emitter.setMaxListeners(0); // many SSE clients per key
  }
  publish(key: string, event: DocEvent): void {
    this.emitter.emit(key, event);
  }
  subscribe(key: string, handler: (e: DocEvent) => void): () => void {
    this.emitter.on(key, handler);
    return () => this.emitter.off(key, handler);
  }
}

const NOTIFY_CHANNEL = "consensum_events";
// Postgres caps NOTIFY payloads at 8000 bytes; keep margin for the JSON envelope.
const MAX_NOTIFY_BYTES = 7900;

// Postgres LISTEN/NOTIFY backend. publish() delivers locally AND notifies peers;
// peers re-emit to their own local subscribers. A single dedicated connection both
// LISTENs and issues NOTIFYs, opened lazily on first use and reconnected with
// backoff. Oversized events (rare: very long comments / suggestions) are delivered
// locally but skipped cross-replica — remote clients recover on the next
// refetch/reconnect (SSE already tolerates gaps).
export class PostgresBus implements EventBus {
  private readonly local = new LocalBus();
  private readonly instanceId = randomUUID();
  private readonly url: string;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1000;

  constructor(url: string) {
    this.url = url;
  }

  publish(key: string, event: DocEvent): void {
    this.local.publish(key, event); // this instance's subscribers, synchronously
    void this.notifyPeers(key, event); // other replicas, best-effort
  }

  subscribe(key: string, handler: (e: DocEvent) => void): () => void {
    void this.ensureConnected(); // start LISTENing so cross-replica events arrive
    return this.local.subscribe(key, handler);
  }

  /** Await the LISTEN connection (used by tests and graceful startup). */
  async ready(): Promise<void> {
    await this.ensureConnected();
  }

  /** Close the connection and stop reconnecting (graceful shutdown / tests). */
  async dispose(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const c = this.client;
    this.client = null;
    this.connecting = null;
    if (c) {
      c.removeAllListeners();
      await c.end().catch(() => {});
    }
  }

  private async notifyPeers(key: string, event: DocEvent): Promise<void> {
    const payload = JSON.stringify({ i: this.instanceId, k: key, e: event });
    if (Buffer.byteLength(payload, "utf8") > MAX_NOTIFY_BYTES) {
      console.warn(
        `[events] ${event.type} on "${key}" exceeds the NOTIFY size limit; ` +
          `delivered locally only (remote clients recover on refetch).`,
      );
      return;
    }
    try {
      const client = await this.ensureConnected();
      await client.query("SELECT pg_notify($1, $2)", [NOTIFY_CHANNEL, payload]);
    } catch (err) {
      console.error("[events] pg_notify failed:", err);
    }
  }

  private ensureConnected(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    if (!this.connecting) this.connecting = this.connect();
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: this.url });
    client.on("notification", (msg) => this.onNotification(msg.payload));
    client.on("error", (err) => {
      console.error("[events] listener connection error:", err);
      this.scheduleReconnect();
    });
    client.on("end", () => this.scheduleReconnect());
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    this.client = client;
    this.connecting = null;
    this.backoffMs = 1000;
    return client;
  }

  private onNotification(payload: string | undefined): void {
    if (!payload) return;
    let msg: { i?: string; k?: string; e?: DocEvent };
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (!msg.k || !msg.e || msg.i === this.instanceId) return; // ignore our own
    this.local.publish(msg.k, msg.e);
  }

  private scheduleReconnect(): void {
    if (this.client) {
      this.client.removeAllListeners();
      void this.client.end().catch(() => {});
      this.client = null;
    }
    this.connecting = null;
    if (this.reconnectTimer) return; // already scheduled
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch(() => this.scheduleReconnect());
    }, delay);
    this.reconnectTimer.unref?.();
  }
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const isPostgres = /^postgres(ql)?:\/\//.test(DATABASE_URL);

// One bus per process; cache on globalThis so dev HMR doesn't open extra LISTEN
// connections. The Postgres backend connects lazily, so constructing it at import
// time (incl. during `next build`) contacts no database.
const globalForBus = globalThis as unknown as { eventBus?: EventBus };
const bus: EventBus =
  globalForBus.eventBus ?? (isPostgres ? new PostgresBus(DATABASE_URL) : new LocalBus());
if (process.env.NODE_ENV !== "production") globalForBus.eventBus = bus;

export function publish(documentId: string, event: DocEvent): void {
  bus.publish(documentId, event);
}

export function subscribe(documentId: string, handler: (e: DocEvent) => void): () => void {
  return bus.subscribe(documentId, handler);
}
