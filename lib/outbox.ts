import { prisma } from "@/lib/db";

const DEFAULT_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];

function backoffTable(): number[] {
  const raw = process.env.OUTBOX_BACKOFF_MS;
  if (!raw) return DEFAULT_BACKOFF_MS;
  const parsed = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : DEFAULT_BACKOFF_MS;
}

/** Delay before the n-th retry (attempts = the new, post-increment attempt count, >= 1). */
export function computeBackoffMs(attempts: number): number {
  const table = backoffTable();
  const idx = Math.min(Math.max(attempts, 1) - 1, table.length - 1);
  return table[idx];
}

type Handler = (payload: unknown) => Promise<void>;

const globalForOutbox = globalThis as unknown as {
  outboxHandlers?: Map<string, Handler>;
  outboxTimer?: ReturnType<typeof setInterval>;
};
const handlers: Map<string, Handler> = globalForOutbox.outboxHandlers ?? new Map();
globalForOutbox.outboxHandlers = handlers;

export function registerHandler(type: string, fn: Handler): void {
  handlers.set(type, fn);
}

/** Test hook: clear the handler registry between tests. */
export function __resetHandlers(): void {
  handlers.clear();
}

export async function enqueue(
  type: string,
  payload: unknown,
  opts?: { delayMs?: number },
): Promise<string> {
  const job = await prisma.outboxJob.create({
    data: {
      type,
      payload: JSON.stringify(payload ?? null),
      nextAttemptAt: new Date(Date.now() + (opts?.delayMs ?? 0)),
    },
  });
  return job.id;
}

/** Single-worker crash recovery: any DELIVERING row is orphaned, so re-arm it. */
export async function recoverStuckJobs(): Promise<void> {
  await prisma.outboxJob.updateMany({ where: { status: "DELIVERING" }, data: { status: "PENDING" } });
}

const BATCH = Number(process.env.OUTBOX_BATCH ?? 25);
let ticking = false;

/** Process all currently-due jobs once. Serialized via an in-process guard. */
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    const due = await prisma.outboxJob.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: BATCH,
    });
    for (const job of due) {
      await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DELIVERING" } });
      const handler = handlers.get(job.type);
      if (!handler) {
        await prisma.outboxJob.update({
          where: { id: job.id },
          data: { status: "DEAD", lastError: `no handler for type "${job.type}"` },
        });
        continue;
      }
      try {
        await handler(JSON.parse(job.payload));
        await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DONE" } });
      } catch (err) {
        const attempts = job.attempts + 1;
        const lastError = err instanceof Error ? err.message : String(err);
        if (attempts >= job.maxAttempts) {
          await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DEAD", attempts, lastError } });
        } else {
          await prisma.outboxJob.update({
            where: { id: job.id },
            data: {
              status: "PENDING",
              attempts,
              lastError,
              nextAttemptAt: new Date(Date.now() + computeBackoffMs(attempts)),
            },
          });
        }
      }
    }
  } finally {
    ticking = false;
  }
}

function shouldAutoStart(): boolean {
  const flag = process.env.OUTBOX_WORKER_AUTOSTART;
  if (flag != null) return flag === "true" || flag === "1";
  return process.env.NODE_ENV !== "test";
}

/** Idempotent. Starts the polling loop once per process (globalThis-guarded). */
export function startOutboxWorker(): void {
  if (!shouldAutoStart()) return;
  if (globalForOutbox.outboxTimer) return;
  const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 5_000);
  void recoverStuckJobs();
  globalForOutbox.outboxTimer = setInterval(() => { void tick(); }, pollMs);
  // Don't keep the event loop alive solely for polling.
  globalForOutbox.outboxTimer.unref?.();
}
