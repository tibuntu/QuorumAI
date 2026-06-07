import { enqueue, registerHandler } from "./outbox";
import { prisma } from "./db";
import { isEmailConfigured, sendMail } from "./email";
import { renderActivityEmail, type ActivityEvent } from "./email-templates";

type Key = string; // `${userId}:${documentId}`
interface Buffer { events: ActivityEvent[]; timer: ReturnType<typeof setTimeout>; userId: string; documentId: string; }

interface DigestPayload { userId: string; documentId: string; events: ActivityEvent[]; }

const buffers = new Map<Key, Buffer>();

function windowMs(): number { return Number(process.env.EMAIL_DEBOUNCE_MS ?? 45000); }

export function enqueueEmailEvent(userId: string, documentId: string, type: ActivityEvent["type"], actorName: string): void {
  if (!isEmailConfigured()) return;
  const key = `${userId}:${documentId}`;
  const existing = buffers.get(key);
  if (existing) {
    existing.events.push({ type, actorName });
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => void flush(key), windowMs());
    return;
  }
  const buf: Buffer = { events: [{ type, actorName }], userId, documentId, timer: setTimeout(() => void flush(key), windowMs()) };
  buffers.set(key, buf);
}

/** Window close: hand the coalesced batch to the durable outbox (best-effort enqueue). */
async function flush(key: Key): Promise<void> {
  const buf = buffers.get(key);
  if (!buf) return;
  buffers.delete(key);
  try {
    const payload: DigestPayload = { userId: buf.userId, documentId: buf.documentId, events: buf.events };
    await enqueue("email.digest", payload);
  } catch { /* best-effort: a failed enqueue at most loses this coalescing window */ }
}

/** The durable side: render + send one coalesced digest. Runs inside the outbox worker. */
async function deliverDigest(payload: unknown): Promise<void> {
  const { userId, documentId, events } = payload as DigestPayload;
  const [user, doc] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.document.findUnique({ where: { id: documentId }, select: { title: true } }),
  ]);
  if (!user?.email || !doc) return; // recipient/doc gone — nothing to deliver
  const mail = renderActivityEmail({ recipientName: user.name, docTitle: doc.title, docId: documentId, events });
  await sendMail({ to: user.email, ...mail });
}

/** Register the email.digest handler with the outbox. Called once at server bootstrap. */
export function registerEmailDigestHandler(): void {
  registerHandler("email.digest", deliverDigest);
}
