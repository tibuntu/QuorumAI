import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const startWorker = vi.fn();
const registerEmail = vi.fn();
const registerWebhook = vi.fn();
vi.mock("@/lib/outbox", () => ({ startOutboxWorker: startWorker }));
vi.mock("@/lib/email-digest", () => ({ registerEmailDigestHandler: registerEmail }));
vi.mock("@/lib/webhooks", () => ({ registerWebhookHandler: registerWebhook }));

describe("instrumentation register()", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });
  afterEach(() => { delete process.env.NEXT_RUNTIME; });

  it("no-ops when not on the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");
    await register();
    expect(startWorker).not.toHaveBeenCalled();
    expect(registerEmail).not.toHaveBeenCalled();
    expect(registerWebhook).not.toHaveBeenCalled();
  });

  it("registers handlers then starts the worker on nodejs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("@/instrumentation");
    await register();
    expect(registerEmail).toHaveBeenCalledTimes(1);
    expect(registerWebhook).toHaveBeenCalledTimes(1);
    expect(startWorker).toHaveBeenCalledTimes(1);
  });
});
