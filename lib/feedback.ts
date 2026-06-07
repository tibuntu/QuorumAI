import { getDocumentDetail } from "@/lib/documents";

type Author = { name?: string | null; email?: string | null } | null;

interface DetailAnnotation {
  id?: string;
  anchorExact: string | null;
  kind?: string;
  status: string;
  threadStatus: string;
  severity?: string | null;
  category?: string | null;
  createdOnVersion?: { versionNumber: number } | null;
  comments: { body: string; author?: Author }[];
}
interface DetailVersion { versionNumber: number; createdAt?: Date | string; createdBy?: Author }

export interface FeedbackDetail {
  state: string;
  currentVersion?: { versionNumber: number } | null;
  versions?: DetailVersion[];
  annotations: DetailAnnotation[];
  reviews: { verdict: string; dismissed: boolean; reviewer?: Author }[];
}

export interface FeedbackThread {
  id: string;
  quote: string | null;
  kind: string;
  status: string;
  threadStatus: string;
  severity: string | null;
  category: string | null;
  anchorState: string;
  raisedOnVersion: number | null;
  comments: { author: string; body: string }[];
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
    kind: a.kind ?? "COMMENT",
    status: a.status,
    threadStatus: a.threadStatus,
    severity: a.severity ?? null,
    category: a.category ?? null,
    anchorState: a.status,
    raisedOnVersion: a.createdOnVersion?.versionNumber ?? null,
    comments: a.comments.map((c) => ({ author: authorName(c.author ?? null), body: c.body })),
  }));
  const reviews = detail.reviews.map((r) => ({ reviewer: authorName(r.reviewer ?? null), verdict: r.verdict, dismissed: r.dismissed }));
  const decision = decisionFor(detail.state);

  const byCategory: Record<string, number> = {};
  const byVersion: Record<string, number> = {};
  for (const t of threads) {
    const cat = t.category ?? "uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (t.raisedOnVersion != null) {
      const v = String(t.raisedOnVersion);
      byVersion[v] = (byVersion[v] ?? 0) + 1;
    }
  }
  const rollup = {
    blocking: threads.filter((t) => t.severity === "BLOCKER").length,
    unresolved: threads.filter((t) => t.threadStatus === "OPEN").length,
    total: threads.length,
    byCategory,
    byVersion,
  };

  const versions = (detail.versions ?? []).map((v) => ({
    number: v.versionNumber,
    createdBy: authorName(v.createdBy ?? null),
    createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : (v.createdAt ?? null),
  }));

  const ordered = threads.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
  const lines: string[] = [`# Review feedback — decision: ${decision}`, ""];
  if (ordered.length === 0) lines.push("_No inline comments._", "");
  for (const t of ordered) {
    const sev = t.severity ? `[${t.severity}] ` : "";
    const tags = `${t.status === "ORPHANED" ? " (orphaned)" : t.status === "MOVED" ? " (moved)" : ""}${t.threadStatus === "RESOLVED" ? " [resolved]" : ""}`;
    lines.push(`## ${sev}On "${t.quote ?? "(unanchored)"}"${tags}`);
    for (const c of t.comments) lines.push(`- **${c.author}:** ${c.body}`);
    lines.push("");
  }
  if (reviews.length) {
    lines.push("## Verdicts");
    for (const r of reviews) lines.push(`- ${r.reviewer}: ${r.verdict}${r.dismissed ? " (dismissed)" : ""}`);
  }

  return {
    schemaVersion: 1 as const,
    decision,
    state: detail.state,
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
