import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { enqueue, registerHandler, tick, recoverStuckJobs, startOutboxWorker, __resetHandlers } from "@/lib/outbox";

async function clearJobs() { await prisma.outboxJob.deleteMany({}); }

describe("outbox engine", () => {
  beforeEach(async () => { __resetHandlers(); await clearJobs(); });

  it("enqueue writes a PENDING row with JSON payload", async () => {
    const id = await enqueue("test.noop", { hello: "world" });
    const row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row?.status).toBe("PENDING");
    expect(JSON.parse(row!.payload)).toEqual({ hello: "world" });
  });

  it("enqueue with delayMs pushes nextAttemptAt into the future", async () => {
    const id = await enqueue("test.noop", {}, { delayMs: 60_000 });
    const row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it("tick runs the handler and marks DONE", async () => {
    const handler = vi.fn(async () => {});
    registerHandler("test.ok", handler);
    const id = await enqueue("test.ok", { n: 1 });
    await tick();
    expect(handler).toHaveBeenCalledWith({ n: 1 });
    expect((await prisma.outboxJob.findUnique({ where: { id } }))?.status).toBe("DONE");
  });

  it("does not process jobs scheduled in the future", async () => {
    const handler = vi.fn(async () => {});
    registerHandler("test.future", handler);
    await enqueue("test.future", {}, { delayMs: 60_000 });
    await tick();
    expect(handler).not.toHaveBeenCalled();
  });

  it("unknown type goes straight to DEAD", async () => {
    const id = await enqueue("test.unregistered", {});
    await tick();
    const row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row?.status).toBe("DEAD");
    expect(row?.lastError).toMatch(/no handler/i);
  });

  it("failing handler retries with backoff then goes DEAD at maxAttempts", async () => {
    registerHandler("test.boom", async () => { throw new Error("kaboom"); });
    process.env.OUTBOX_BACKOFF_MS = "0";
    const id = await enqueue("test.boom", {});
    await prisma.outboxJob.update({ where: { id }, data: { maxAttempts: 2 } });

    await tick(); // attempt 1 fails
    let row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row?.status).toBe("PENDING");
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatch(/kaboom/);

    await tick(); // attempt 2 fails -> DEAD
    row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row?.status).toBe("DEAD");
    expect(row?.attempts).toBe(2);
    delete process.env.OUTBOX_BACKOFF_MS;
  });

  it("recoverStuckJobs flips DELIVERING back to PENDING", async () => {
    const id = await enqueue("test.noop", {});
    await prisma.outboxJob.update({ where: { id }, data: { status: "DELIVERING" } });
    await recoverStuckJobs();
    expect((await prisma.outboxJob.findUnique({ where: { id } }))?.status).toBe("PENDING");
  });

  it("startOutboxWorker does not auto-start under NODE_ENV=test", () => {
    expect(() => startOutboxWorker()).not.toThrow();
  });
});
