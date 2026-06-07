import { randomBytes, createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { enqueue, registerHandler } from "@/lib/outbox";
import type { WebhookEvent } from "@/lib/enums";

/** True for loopback / link-local / private-range literal IPs (v4 + minimal v6). */
export function isPrivateIp(host: string): boolean {
  const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 0 || a === 10) return true;          // loopback, this-host, private
  if (a === 169 && b === 254) return true;                    // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;           // private
  if (a === 192 && b === 168) return true;                    // private
  return false;
}

/**
 * SSRF guard. In production: require https + reject loopback/link-local/private hosts
 * (literal IPs and well-known names). Outside production: permissive (http+localhost ok)
 * so the e2e sink works. `WEBHOOK_ALLOW_INSECURE=true` bypasses entirely (tests / self-host
 * pointing at internal services). Throws on rejection.
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("invalid URL"); }
  if (process.env.WEBHOOK_ALLOW_INSECURE === "true") return;
  if (process.env.NODE_ENV !== "production") return;
  if (parsed.protocol !== "https:") throw new Error("webhook URL must use https");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("webhook URL host not allowed");
  }
  if (isPrivateIp(host)) throw new Error("webhook URL host not allowed");
}

export interface CreateWebhookInput { url: string; events: WebhookEvent[]; documentId?: string | null; }

export async function createWebhook(ownerId: string, input: CreateWebhookInput) {
  validateWebhookUrl(input.url);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.webhook.create({
    data: {
      ownerId,
      url: input.url,
      documentId: input.documentId ?? null,
      events: input.events.join(","),
      secretEnc: encryptSecret(secret),
    },
  });
  return { id: row.id, secret }; // secret revealed once
}

export async function listWebhooks(ownerId: string) {
  return prisma.webhook.findMany({
    where: { ownerId },
    select: { id: true, url: true, documentId: true, events: true, active: true, createdAt: true, lastStatus: true, lastError: true, lastDeliveredAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateWebhook(ownerId: string, id: string, patch: { active?: boolean; events?: WebhookEvent[] }) {
  const data: { active?: boolean; events?: string } = {};
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.events !== undefined) data.events = patch.events.join(",");
  await prisma.webhook.updateMany({ where: { id, ownerId }, data });
}

export async function deleteWebhook(ownerId: string, id: string) {
  await prisma.webhook.deleteMany({ where: { id, ownerId } });
}

/**
 * Fan a domain event out to every active webhook that matches (owner of the document +
 * optional single-doc narrowing + event in the CSV filter). One durable outbox job per
 * match; the worker signs + POSTs (next task). Best-effort: callers wrap in `.catch(()=>{})`.
 */
export async function dispatch(documentId: string, event: WebhookEvent, body: Record<string, unknown>, actorId?: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { ownerId: true } });
  if (!doc) return;
  const candidates = await prisma.webhook.findMany({
    where: { ownerId: doc.ownerId, active: true, OR: [{ documentId: null }, { documentId }] },
    select: { id: true, events: true },
  });
  const matches = candidates.filter((w) => w.events.split(",").map((s) => s.trim()).includes(event));
  if (matches.length === 0) return;

  let actor = "Someone";
  if (actorId) {
    const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    actor = u?.name ?? actor;
  }
  const occurredAt = new Date().toISOString();
  for (const w of matches) {
    await enqueue("webhook.deliver", { ...body, webhookId: w.id, event, planId: documentId, occurredAt, actor });
  }
}

export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

interface DeliverPayload { webhookId: string; event: string; [k: string]: unknown; }

function isDeliverPayload(v: unknown): v is DeliverPayload {
  return typeof v === "object" && v !== null && typeof (v as DeliverPayload).webhookId === "string" && typeof (v as DeliverPayload).event === "string";
}

/** The durable side: sign + POST one webhook event. Runs inside the outbox worker. */
export async function deliverWebhook(payload: unknown): Promise<void> {
  if (!isDeliverPayload(payload)) throw new Error("webhook.deliver: malformed payload");
  const wh = await prisma.webhook.findUnique({ where: { id: payload.webhookId } });
  if (!wh) return; // webhook deleted between enqueue and delivery — nothing to do

  const body = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  let recorded = false; // true once we've written a status row for this attempt
  try {
    validateWebhookUrl(wh.url); // re-check at delivery (DNS-rebinding / policy guard)
    const secret = decryptSecret(wh.secretEnc);
    const res = await fetch(wh.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Quorum-Event": payload.event,
        "X-Quorum-Timestamp": timestamp,
        "X-Quorum-Signature": signBody(secret, body),
      },
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      await prisma.webhook.update({ where: { id: wh.id }, data: { lastStatus: String(res.status), lastError: `non-2xx: ${res.status}` } });
      recorded = true;
      throw new Error(`webhook delivery failed: ${res.status}`); // → outbox retries
    }
    await prisma.webhook.update({ where: { id: wh.id }, data: { lastStatus: String(res.status), lastDeliveredAt: new Date(), lastError: null } });
  } catch (err) {
    if (!recorded) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.webhook.update({ where: { id: wh.id }, data: { lastStatus: "ERR", lastError: msg } });
    }
    throw err; // rethrow so the outbox retries / dead-letters
  }
}

function hasWebhookId(v: unknown): v is { webhookId: string } {
  return typeof v === "object" && v !== null && typeof (v as { webhookId: string }).webhookId === "string";
}

/** Terminal failure: surface DEAD on the webhook row so the owner sees a dead endpoint. */
export async function onDeadWebhook(payload: unknown, lastError: string): Promise<void> {
  if (!hasWebhookId(payload)) return;
  await prisma.webhook.updateMany({ where: { id: payload.webhookId }, data: { lastStatus: "DEAD", lastError } });
}

/** Register the webhook.deliver handler (+ onDead) with the outbox. Called at bootstrap. */
export function registerWebhookHandler(): void {
  registerHandler("webhook.deliver", deliverWebhook, onDeadWebhook);
}
