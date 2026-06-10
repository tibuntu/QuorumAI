import { EventEmitter } from "node:events";

export interface ClientNotification {
  id: string;
  type: string; // "comment" | "review" | "version" | "resolve" (see notifications.ts)
  documentId: string;
  documentTitle: string;
  actorId: string | null;
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

const globalForEvents = globalThis as unknown as { docEvents?: EventEmitter };
const emitter = globalForEvents.docEvents ?? new EventEmitter();
emitter.setMaxListeners(0); // many SSE clients per document
if (process.env.NODE_ENV !== "production") globalForEvents.docEvents = emitter;

export function publish(documentId: string, event: DocEvent): void {
  emitter.emit(documentId, event);
}

export function subscribe(documentId: string, handler: (e: DocEvent) => void): () => void {
  emitter.on(documentId, handler);
  return () => {
    emitter.off(documentId, handler);
  };
}
