export const MAX_REQUIRED_APPROVALS = 10;

/** Validate a requiredApprovals input. Returns the integer if 1..10, else null. Never throws. */
export function parseRequiredApprovals(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_REQUIRED_APPROVALS) return null;
  return value;
}

/** Count active (non-dismissed) APPROVE reviews — the "N" in "N of M approvals". */
export function approvalCount(reviews: { verdict: string; dismissed: boolean }[]): number {
  return reviews.filter((r) => !r.dismissed && r.verdict === "APPROVE").length;
}
