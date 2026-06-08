import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

import { prisma } from "@/lib/db";
import * as api from "@/lib/api";
import { createDocument } from "@/lib/documents";

let userSeq = 0;
async function makeUser(email: string) {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${++userSeq}-${email}`, name: email.split("@")[0], email, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("DELETE /api/documents/[id]", () => {
  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.documentParticipant.deleteMany();
    await prisma.document.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.user.deleteMany();
  });

  it("401 unauth; 404 stranger; 403 non-owner participant; 200 owner + gone", async () => {
    const owner = await makeUser("owner@example.com");
    const part = await makeUser("part@example.com");
    const stranger = await makeUser("str@example.com");
    const id = await createDocument(owner.id, "Plan", "# hi");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: part.id } });

    const { DELETE } = await import("@/app/api/documents/[id]/route");

    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    expect((await DELETE(new Request("http://t"), ctx(id))).status).toBe(401);

    vi.mocked(api.requireUser).mockResolvedValue({ id: stranger.id } as never);
    expect((await DELETE(new Request("http://t"), ctx(id))).status).toBe(404);

    vi.mocked(api.requireUser).mockResolvedValue({ id: part.id } as never);
    expect((await DELETE(new Request("http://t"), ctx(id))).status).toBe(403);

    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const ok = await DELETE(new Request("http://t"), ctx(id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(await prisma.document.findUnique({ where: { id } })).toBeNull();
  });
});
