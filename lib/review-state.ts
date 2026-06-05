import type { ReviewVerdict, DocumentState } from "@/lib/enums";

export interface ReviewInput {
  verdict: ReviewVerdict;
  dismissed: boolean;
}

export function computeDocumentState(reviews: ReviewInput[], requiredApprovals: number): DocumentState {
  const active = reviews.filter((r) => !r.dismissed);
  if (active.some((r) => r.verdict === "REQUEST_CHANGES")) return "CHANGES_REQUESTED";
  const approvals = active.filter((r) => r.verdict === "APPROVE").length;
  if (approvals >= requiredApprovals) return "APPROVED";
  return "OPEN";
}
