import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/email", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendMail: vi.fn(async () => {}),
}));
vi.mock("../../lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ name: "Bo", email: "bo@e.com" })) },
    document: { findUnique: vi.fn(async () => ({ title: "Plan A" })) },
  },
}));

describe("email digest", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); process.env.EMAIL_DEBOUNCE_MS = "50"; });
  afterEach(() => { vi.useRealTimers(); });

  it("coalesces a burst into one email", async () => {
    const { enqueueEmailEvent } = await import("../../lib/email-digest");
    const email = await import("../../lib/email");
    enqueueEmailEvent("u1", "doc1", "comment", "Al");
    enqueueEmailEvent("u1", "doc1", "comment", "Cy");
    enqueueEmailEvent("u1", "doc1", "review", "Al");
    await vi.advanceTimersByTimeAsync(60);
    expect(email.sendMail).toHaveBeenCalledTimes(1);
  });

  it("no-op when unconfigured", async () => {
    const email = await import("../../lib/email");
    vi.mocked(email.isEmailConfigured).mockReturnValueOnce(false);
    const { enqueueEmailEvent } = await import("../../lib/email-digest");
    enqueueEmailEvent("u2", "doc2", "comment", "Al");
    await vi.advanceTimersByTimeAsync(60);
    expect(email.sendMail).not.toHaveBeenCalled();
  });
});
