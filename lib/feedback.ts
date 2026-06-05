import { getDocumentDetail } from "@/lib/documents";

type Author = { name?: string | null; email?: string | null } | null;

export interface FeedbackDetail {
  state: string;
  annotations: { anchorExact: string | null; status: string; threadStatus: string; comments: { body: string; author?: Author }[] }[];
  reviews: { verdict: string; dismissed: boolean; reviewer?: Author }[];
}

export type Decision = "pending" | "approved" | "changes_requested";

function decisionFor(state: string): Decision {
  if (state === "CHANGES_REQUESTED") return "changes_requested";
  if (state === "APPROVED") return "approved";
  return "pending";
}

function authorName(a: Author): string {
  return a?.name ?? a?.email ?? "someone";
}

export function consolidateFeedback(detail: FeedbackDetail) {
  const threads = detail.annotations.map((a) => ({
    quote: a.anchorExact,
    status: a.status,
    threadStatus: a.threadStatus,
    comments: a.comments.map((c) => ({ author: authorName(c.author ?? null), body: c.body })),
  }));
  const reviews = detail.reviews.map((r) => ({ reviewer: authorName(r.reviewer ?? null), verdict: r.verdict, dismissed: r.dismissed }));
  const decision = decisionFor(detail.state);

  const lines: string[] = [`# Review feedback — decision: ${decision}`, ""];
  if (threads.length === 0) lines.push("_No inline comments._", "");
  for (const t of threads) {
    const tags = `${t.status === "ORPHANED" ? " (orphaned)" : t.status === "MOVED" ? " (moved)" : ""}${t.threadStatus === "RESOLVED" ? " [resolved]" : ""}`;
    lines.push(`## On "${t.quote ?? "(unanchored)"}"${tags}`);
    for (const c of t.comments) lines.push(`- **${c.author}:** ${c.body}`);
    lines.push("");
  }
  if (reviews.length) {
    lines.push("## Verdicts");
    for (const r of reviews) lines.push(`- ${r.reviewer}: ${r.verdict}${r.dismissed ? " (dismissed)" : ""}`);
  }

  return { decision, state: detail.state, markdown: lines.join("\n"), threads, reviews };
}

export async function getPlanFeedback(documentId: string) {
  const detail = await getDocumentDetail(documentId);
  if (!detail) return null;
  return consolidateFeedback(detail as unknown as FeedbackDetail);
}
