import { getDocumentDetail } from "@/lib/documents";
import { approvalCount } from "@/lib/approvals";

type Author = { name?: string | null; email?: string | null } | null;

interface DetailAnnotation {
  id?: string;
  anchorExact: string | null;
  anchorPrefix?: string | null;
  anchorSuffix?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  kind?: string;
  status: string;
  threadStatus: string;
  resolution?: string | null;
  severity?: string | null;
  category?: string | null;
  createdOnVersion?: { versionNumber: number } | null;
  suggestedText?: string | null;
  appliedInVersion?: { versionNumber: number } | null;
  createdAt?: Date | string;
  comments: { id?: string; body: string; author?: Author; createdAt?: Date | string }[];
}
interface DetailVersion { versionNumber: number; createdAt?: Date | string; createdBy?: Author }

export interface FeedbackDetail {
  state: string;
  requiredApprovals?: number;
  agentContext?: string | null;
  currentVersion?: { versionNumber: number } | null;
  versions?: DetailVersion[];
  annotations: DetailAnnotation[];
  reviews: { id?: string; verdict: string; dismissed: boolean; reviewer?: Author; createdAt?: Date | string; onVersion?: { versionNumber: number } | null }[];
}

export interface FeedbackThread {
  id: string;
  quote: string | null;
  anchorPrefix: string | null;
  anchorSuffix: string | null;
  startOffset: number | null;
  endOffset: number | null;
  kind: string;
  status: string;
  threadStatus: string;
  // Why a RESOLVED thread was closed (FIXED / WONTFIX / OBSOLETE), else null —
  // lets the agent tell "addressed" from "won't-fix" without guessing.
  resolution: string | null;
  severity: string | null;
  category: string | null;
  anchorState: string;
  // Binding signal for an autonomous consumer: an open BLOCKER it must not
  // proceed past. Severity alone is advisory; this makes the obligation explicit
  // in the payload (the agent still decides — no decision-math change).
  mustResolve: boolean;
  raisedOnVersion: number | null;
  appliedInVersion: { versionNumber: number } | null;
  suggestedText: string | null;
  createdAt: string | null;
  comments: { id: string; author: string; body: string; createdAt: string | null }[];
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

function toIso(d?: Date | string | null): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : d;
}

const FILTER_TAGS = ["blocking", "unresolved", "resolved", "orphaned"] as const;
type FilterTag = (typeof FILTER_TAGS)[number];

function hasTag(t: FeedbackThread, tag: FilterTag): boolean {
  switch (tag) {
    case "blocking": return t.severity === "BLOCKER";
    case "unresolved": return t.threadStatus === "OPEN";
    case "resolved": return t.threadStatus === "RESOLVED";
    case "orphaned": return t.anchorState === "ORPHANED";
  }
}

export function filterThreads(
  threads: FeedbackThread[],
  opts: { include?: string[]; exclude?: string[] }
): FeedbackThread[] {
  const include = (opts.include ?? []).filter((t): t is FilterTag => (FILTER_TAGS as readonly string[]).includes(t));
  const exclude = (opts.exclude ?? []).filter((t): t is FilterTag => (FILTER_TAGS as readonly string[]).includes(t));
  return threads.filter((t) => {
    if (exclude.some((tag) => hasTag(t, tag))) return false;
    if (include.length && !include.some((tag) => hasTag(t, tag))) return false;
    return true;
  });
}

function rank(t: FeedbackThread): number {
  if (t.severity === "BLOCKER") return 0;
  if (t.threadStatus === "OPEN") return 1;
  return 2;
}

export function consolidateFeedback(detail: FeedbackDetail) {
  const threads: FeedbackThread[] = detail.annotations.map((a) => ({
    id: a.id ?? "",
    quote: a.anchorExact,
    anchorPrefix: a.anchorPrefix ?? null,
    anchorSuffix: a.anchorSuffix ?? null,
    startOffset: a.startOffset ?? null,
    endOffset: a.endOffset ?? null,
    kind: a.kind ?? "COMMENT",
    status: a.status, // backward-compat alias; Annotation.status IS the anchor state (ACTIVE/MOVED/ORPHANED)
    threadStatus: a.threadStatus,
    resolution: a.resolution ?? null,
    severity: a.severity ?? null,
    category: a.category ?? null,
    anchorState: a.status, // canonical spec name for the same value as `status`
    mustResolve: a.severity === "BLOCKER" && a.threadStatus === "OPEN",
    raisedOnVersion: a.createdOnVersion?.versionNumber ?? null,
    appliedInVersion: a.appliedInVersion ?? null,
    suggestedText: a.suggestedText ?? null,
    createdAt: toIso(a.createdAt),
    comments: a.comments.map((c) => ({ id: c.id ?? "", author: authorName(c.author ?? null), body: c.body, createdAt: toIso(c.createdAt) })),
  }));
  const reviews = detail.reviews.map((r) => ({
    id: r.id ?? "",
    reviewer: authorName(r.reviewer ?? null),
    verdict: r.verdict,
    dismissed: r.dismissed,
    onVersion: r.onVersion?.versionNumber ?? null,
    createdAt: toIso(r.createdAt),
  }));
  const decision = decisionFor(detail.state);
  const approvals = approvalCount(detail.reviews);
  const requiredApprovals = detail.requiredApprovals ?? 1;

  // Reviewer-conflict signals: the app can't detect semantic conflicts (no
  // LLM), but it can flag when humans are split so the agent escalates to a
  // decider instead of picking a side.
  const activeReviews = detail.reviews.filter((r) => !r.dismissed);
  const reviewersRequestingChanges = activeReviews.filter((r) => r.verdict === "REQUEST_CHANGES").length;
  const reviewerSplit = activeReviews.some((r) => r.verdict === "APPROVE") && activeReviews.some((r) => r.verdict === "REQUEST_CHANGES");

  const byCategory: Record<string, number> = {};
  const byVersion: Record<string, number> = {};
  for (const t of threads) {
    const cat = t.category && t.category.trim() !== "" ? t.category : "uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (t.raisedOnVersion != null) {
      const v = String(t.raisedOnVersion);
      byVersion[v] = (byVersion[v] ?? 0) + 1;
    }
  }
  const rollup = {
    blocking: threads.filter((t) => t.severity === "BLOCKER").length,
    // Open blockers an autonomous consumer must clear before proceeding. The
    // agent gate is `mustResolve === 0 && decision === "approved"`.
    mustResolve: threads.filter((t) => t.mustResolve).length,
    unresolved: threads.filter((t) => t.threadStatus === "OPEN").length,
    total: threads.length,
    // ≥2 ⇒ multiple humans want changes (possibly conflicting); reviewerSplit ⇒
    // some approve while others reject. Either way: reconcile, don't guess.
    reviewersRequestingChanges,
    reviewerSplit,
    byCategory,
    byVersion,
  };

  const versions = (detail.versions ?? []).map((v) => ({
    number: v.versionNumber,
    createdBy: authorName(v.createdBy ?? null),
    createdAt: toIso(v.createdAt),
  }));

  const ordered = threads.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
  const lines: string[] = [`# Review feedback — decision: ${decision}`, ""];
  lines.push(`Approvals: ${approvals} of ${requiredApprovals}`, "");
  if (ordered.length === 0) lines.push("_No inline comments._", "");
  for (const t of ordered) {
    const sev = t.severity ? `[${t.severity}] ` : "";
    const tags = `${t.anchorState === "ORPHANED" ? " (orphaned)" : t.anchorState === "MOVED" ? " (moved)" : ""}${t.threadStatus === "RESOLVED" ? " [resolved]" : ""}${t.appliedInVersion ? ` [applied as v${t.appliedInVersion.versionNumber}]` : ""}`;
    lines.push(`## ${sev}On "${t.quote ?? "(unanchored)"}"${tags}`);
    for (const c of t.comments) lines.push(`- **${c.author}:** ${c.body}`);
    if (t.kind === "SUGGESTION" && t.suggestedText) lines.push(`- _Suggested replacement:_ "${t.suggestedText}"`);
    lines.push("");
  }
  if (reviews.length) {
    const VERDICT_LABEL: Record<string, string> = { APPROVE: "Approved", REQUEST_CHANGES: "Changes requested", COMMENT: "Commented" };
    lines.push("## Decisions");
    for (const r of reviews) lines.push(`- ${r.reviewer}: ${VERDICT_LABEL[r.verdict] ?? r.verdict}${r.dismissed ? " (dismissed)" : ""}`);
  }

  return {
    schemaVersion: 1 as const,
    decision,
    state: detail.state,
    requiredApprovals,
    approvals,
    // Echoed back so an agent resuming a multi-day review can recover the
    // context it supplied on push (previously write-only).
    agentContext: detail.agentContext ?? null,
    markdown: lines.join("\n"),
    currentVersion: detail.currentVersion?.versionNumber ?? null,
    versions,
    rollup,
    threads,
    reviews,
  };
}

export async function getPlanFeedback(documentId: string, filter?: { include?: string[]; exclude?: string[] }) {
  const detail = await getDocumentDetail(documentId);
  if (!detail) return null;
  const consolidated = consolidateFeedback(detail as unknown as FeedbackDetail);
  if (filter && (filter.include?.length || filter.exclude?.length)) {
    return { ...consolidated, threads: filterThreads(consolidated.threads, filter) };
  }
  return consolidated;
}
