import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/settings/notifications/route";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

async function makeUser(label: string) {
  const now = new Date();
  return prisma.user.create({
    data: {
      id: `u-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name: "x",
      email: `u-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
  });
}
const req = (b: unknown) =>
  new Request("http://t", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

describe("PATCH /api/settings/notifications", () => {
  beforeEach(() => vi.mocked(api.requireUser).mockReset());

  test("updates a valid cell and persists", async () => {
    const u = await makeUser("a");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    const res = await PATCH(req({ type: "comment", channel: "email", enabled: false }));
    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { notificationPrefs: true } });
    const prefs = row?.notificationPrefs as Record<string, Record<string, boolean>>;
    expect(prefs.comment.email).toBe(false);
    expect(prefs.comment.inApp).toBe(true); // default preserved
  });

  test("400 on the resolve+email cell", async () => {
    const u = await makeUser("b");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    expect((await PATCH(req({ type: "resolve", channel: "email", enabled: true }))).status).toBe(400);
  });

  test("400 on unknown type/channel and non-boolean enabled", async () => {
    const u = await makeUser("c");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    expect((await PATCH(req({ type: "bogus", channel: "email", enabled: true }))).status).toBe(400);
    expect((await PATCH(req({ type: "comment", channel: "bogus", enabled: true }))).status).toBe(400);
    expect((await PATCH(req({ type: "comment", channel: "email", enabled: "yes" }))).status).toBe(400);
  });
});
