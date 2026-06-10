"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DiffRow } from "@/lib/diff";

interface VersionMeta { versionNumber: number; createdAt: string | Date; contentHash: string; createdBy: { name: string }; }

export function VersionHistory({
  documentId, versions, from, to, rows, singleMarkdown,
}: { documentId: string; versions: VersionMeta[]; from: number; to: number; rows: DiffRow[] | null; singleMarkdown: string | null; }) {
  const router = useRouter();
  const numbers = versions.map((v) => v.versionNumber);
  const nav = (f: number, t: number) => router.push(`/app/documents/${documentId}/history?from=${f}&to=${t}`);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Version history</h1>
        <Link href={`/app/documents/${documentId}`} className="text-sm text-primary hover:underline">← Back to document</Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="text-muted">Compare</label>
        <select data-testid="from-select" className="rounded border border-border bg-surface px-2 py-1"
          value={from} onChange={(e) => nav(Number(e.target.value), to)}>
          {numbers.map((n) => <option key={n} value={n}>v{n}</option>)}
        </select>
        <span className="text-muted">→</span>
        <select data-testid="to-select" className="rounded border border-border bg-surface px-2 py-1"
          value={to} onChange={(e) => nav(from, Number(e.target.value))}>
          {numbers.map((n) => <option key={n} value={n}>v{n}</option>)}
        </select>
      </div>

      {singleMarkdown !== null ? (
        <p className="text-sm text-muted">Only one version exists — no earlier version to compare.</p>
      ) : rows ? (
        <div data-testid="diff" className="overflow-x-auto rounded border border-border">
          <div className="grid grid-cols-1 border-b border-border bg-[var(--state-neutral-bg)] text-xs font-medium text-muted lg:grid-cols-2">
            <span className="border-b border-border px-2 py-1 lg:border-b-0 lg:border-r">Old · v{from}</span>
            <span className="px-2 py-1">New · v{to}</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 lg:grid-cols-2 font-mono text-xs">
              <Side spans={r.oldSpans} text={r.oldText} number={r.oldNumber} side="old" kind={r.kind} />
              <Side spans={r.newSpans} text={r.newText} number={r.newNumber} side="new" kind={r.kind} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Select two different versions to compare.</p>
      )}
    </div>
  );
}

function Side({ spans, text, number, side, kind }: {
  spans?: { value: string; added?: boolean; removed?: boolean }[]; text?: string; number?: number;
  side: "old" | "new"; kind: DiffRow["kind"];
}) {
  const empty = (side === "old" && kind === "added") || (side === "new" && kind === "removed");
  const bg = empty ? "" : kind === "removed" && side === "old" ? "bg-[var(--state-changes-bg)]"
    : kind === "added" && side === "new" ? "bg-[var(--state-approved-bg)]"
    : kind === "changed" ? (side === "old" ? "bg-[var(--state-changes-bg)]" : "bg-[var(--state-approved-bg)]") : "";
  return (
    <div className={`flex gap-2 border-b border-border px-2 py-0.5 ${bg}`}>
      <span className="w-8 shrink-0 select-none text-right text-muted">{number ?? ""}</span>
      <pre className="whitespace-pre-wrap break-words">{spans ? spans.map((s, i) => (
        <span key={i} className={s.added ? "bg-[var(--state-approved)] text-[var(--primary-fg)]" : s.removed ? "bg-[var(--state-changes)] text-[var(--primary-fg)] line-through" : ""}>{s.value}</span>
      )) : (empty ? "" : text)}</pre>
    </div>
  );
}
