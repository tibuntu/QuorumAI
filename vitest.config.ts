import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  // Tests share one SQLite file; run files sequentially so parallel workers
  // don't contend on the single write lock (intermittent "Operation has timed
  // out" on concurrent writes/upserts).
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"], fileParallelism: false },
});
