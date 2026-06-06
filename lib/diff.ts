import { diffLines, diffWords } from "diff";

export interface WordSpan { value: string; added?: boolean; removed?: boolean; }
export interface DiffRow {
  kind: "unchanged" | "added" | "removed" | "changed";
  oldNumber?: number;
  newNumber?: number;
  oldText?: string;
  newText?: string;
  oldSpans?: WordSpan[];
  newSpans?: WordSpan[];
}

/** Side-by-side diff of two markdown sources, line-based with intra-line word spans. */
export function diffMarkdown(oldText: string, newText: string): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldNo = 1, newNo = 1;

  // Buffer consecutive removed/added blocks so adjacent removed+added pair into "changed".
  let pendingRemoved: string[] = [];
  let pendingAdded: string[] = [];

  const flushPair = () => {
    const n = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < n; i++) {
      const o = pendingRemoved[i]; const a = pendingAdded[i];
      if (o !== undefined && a !== undefined) {
        const words = diffWords(o, a);
        rows.push({
          kind: "changed", oldNumber: oldNo++, newNumber: newNo++, oldText: o, newText: a,
          oldSpans: words.filter((w) => !w.added).map((w) => ({ value: w.value, removed: w.removed })),
          newSpans: words.filter((w) => !w.removed).map((w) => ({ value: w.value, added: w.added })),
        });
      } else if (o !== undefined) {
        rows.push({ kind: "removed", oldNumber: oldNo++, oldText: o });
      } else if (a !== undefined) {
        rows.push({ kind: "added", newNumber: newNo++, newText: a });
      }
    }
    pendingRemoved = []; pendingAdded = [];
  };

  const splitLines = (s: string): string[] => {
    const arr = s.split("\n");
    if (arr.length > 1 && arr[arr.length - 1] === "") arr.pop(); // trailing newline artifact
    return arr;
  };

  for (const part of parts) {
    const lines = splitLines(part.value);
    if (part.added) { pendingAdded.push(...lines); continue; }
    if (part.removed) { pendingRemoved.push(...lines); continue; }
    flushPair();
    for (const line of lines) rows.push({ kind: "unchanged", oldNumber: oldNo++, newNumber: newNo++, oldText: line, newText: line });
  }
  flushPair();
  return rows;
}
