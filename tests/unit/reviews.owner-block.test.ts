import { describe, it, expect, vi, beforeEach } from "vitest";

// requireUser is mocked per-test; mirror the webhooks route test harness.
vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

import { prisma } from "@/lib/db";
import * as api from "@/lib/api";
import { createDocument } from "@/lib/documents";
import { isOwner, isParticipant } from "@/lib/authz";

let userSeq = 0;
async function makeUser(email: string) {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${++userSeq}-${email}`, name: email.split("@")[0], email, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

function req(body: unknown) {
  return new Request("http://t/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("owner verdict block", () => {
  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.documentParticipant.deleteMany();
    await prisma.document.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.user.deleteMany();
  });

  it("owner is a participant of their own document", async () => {
    const owner = await makeUser("owner@example.com");
    const id = await createDocument(owner.id, "Plan", "# hi");
    expect(await isParticipant(owner.id, id)).toBe(true);
    expect(await isOwner(owner.id, id)).toBe(true);
  });

  it("owner verdict is rejected with 403", async () => {
    const owner = await makeUser("owner@example.com");
    const id = await createDocument(owner.id, "Plan", "# hi");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id, email: owner.email } as never);
    const { POST } = await import("@/app/api/documents/[id]/reviews/route");
    const res = await POST(req({ verdict: "APPROVE" }), ctx(id));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owners cannot review their own document" });
  });

  it("participant (non-owner) verdict is accepted", async () => {
    const owner = await makeUser("owner@example.com");
    const reviewer = await makeUser("rev@example.com");
    const id = await createDocument(owner.id, "Plan", "# hi");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: reviewer.id } });
    vi.mocked(api.requireUser).mockResolvedValue({ id: reviewer.id, email: reviewer.email } as never);
    const { POST } = await import("@/app/api/documents/[id]/reviews/route");
    const res = await POST(req({ verdict: "APPROVE" }), ctx(id));
    expect(res.status).toBe(200);
  });
});
