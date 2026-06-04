import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

function createAdapter() {
  const url = process.env.DATABASE_URL ?? "file:./data/app.db";
  return new PrismaBetterSqlite3({ url });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: createAdapter() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Enable WAL mode for better concurrent read performance
prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;").catch((err) => { console.error("[db] Failed to set WAL mode:", err); });
