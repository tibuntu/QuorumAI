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

export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number; // epoch ms
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
  | { type: "presence.left"; userId: string };

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
