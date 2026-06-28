import "dotenv/config";
import { defineConfig } from "prisma/config";

const isPostgres = /^postgres/.test(process.env.DB_PROVIDER ?? "");

export default defineConfig({
  schema: isPostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma",
  migrations: {
    path: isPostgres ? "prisma/migrations-postgres" : "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
