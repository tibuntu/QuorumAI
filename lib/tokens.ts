import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function generateToken(userId: string, label: string) {
  const token = `qai_${randomBytes(32).toString("base64url")}`;
  const row = await prisma.apiToken.create({ data: { userId, label, tokenHash: hashToken(token) } });
  return { id: row.id, token };
}

export async function verifyToken(authorization: string | null) {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(match[1]) }, include: { user: true } });
  if (!row) return null;
  await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return row.user;
}

export async function listTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    select: { id: true, label: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeToken(userId: string, id: string) {
  await prisma.apiToken.deleteMany({ where: { id, userId } });
}
