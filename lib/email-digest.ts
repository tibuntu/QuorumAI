import { prisma } from "./db";
import { isEmailConfigured, sendMail } from "./email";
import { renderActivityEmail, type ActivityEvent } from "./email-templates";

type Key = string; // `${userId}:${documentId}`
interface Buffer { events: ActivityEvent[]; timer: ReturnType<typeof setTimeout>; userId: string; documentId: string; }

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

async function flush(key: Key): Promise<void> {
  const buf = buffers.get(key);
  if (!buf) return;
  buffers.delete(key);
  try {
    const [user, doc] = await Promise.all([
      prisma.user.findUnique({ where: { id: buf.userId }, select: { name: true, email: true } }),
      prisma.document.findUnique({ where: { id: buf.documentId }, select: { title: true } }),
    ]);
    if (!user?.email || !doc) return;
    const mail = renderActivityEmail({ recipientName: user.name, docTitle: doc.title, docId: buf.documentId, events: buf.events });
    await sendMail({ to: user.email, ...mail });
  } catch { /* best-effort */ }
}
