const DEFAULT_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];

function backoffTable(): number[] {
  const raw = process.env.OUTBOX_BACKOFF_MS;
  if (!raw) return DEFAULT_BACKOFF_MS;
  const parsed = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : DEFAULT_BACKOFF_MS;
}

/** Delay before the n-th retry (attempts = the new, post-increment attempt count, >= 1). */
export function computeBackoffMs(attempts: number): number {
  const table = backoffTable();
  const idx = Math.min(Math.max(attempts, 1) - 1, table.length - 1);
  return table[idx];
}
