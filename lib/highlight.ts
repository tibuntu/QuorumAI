import { relocate } from "@/lib/anchoring";
import type { RemoteSelection } from "@/lib/presence-client";
import { selectionColorFor } from "@/lib/presence-roster";

export interface HighlightRange {
  id: string;
  start: number;
  end: number;
  status?: string; // "ACTIVE" | "MOVED"
}

export interface AnnotationAnchor {
  id: string;
  anchorExact: string | null;
  anchorPrefix: string | null;
  anchorSuffix: string | null;
  threadStatus: string;
}

/**
 * Relocate each annotation against `containerText` and produce the highlight ranges.
 * RESOLVED threads are excluded from `ranges` (their in-text marker should disappear —
 * the comment stays visible in the sidebar), but every annotation's relocate `status`
 * is still reported so callers can surface MOVED/ORPHANED indicators regardless.
 */
export function buildHighlightRanges(
  containerText: string,
  annotations: AnnotationAnchor[],
): { ranges: HighlightRange[]; statuses: Record<string, string> } {
  const ranges: HighlightRange[] = [];
  const statuses: Record<string, string> = {};
  for (const a of annotations) {
    const r = relocate(containerText, {
      exact: a.anchorExact ?? "",
      prefix: a.anchorPrefix ?? "",
      suffix: a.anchorSuffix ?? "",
    });
    statuses[a.id] = r.status;
    if (r.range && a.threadStatus !== "RESOLVED") {
      ranges.push({ id: a.id, start: r.range.start, end: r.range.end, status: r.status });
    }
  }
  return { ranges, statuses };
}

/**
 * Wrap each range's `[start,end)` slice (offsets measured against the container's
 * concatenated text content) in a `<mark data-annotation-id>`. Idempotent: existing
 * marks are unwrapped first, then re-applied. Ranges that would cross an element
 * boundary are skipped (MVP fallback — see plan Task 7 Step 4).
 */
export function applyHighlights(container: HTMLElement, ranges: HighlightRange[]): void {
  clearHighlights(container);
  for (const range of ranges) {
    wrapRange(container, range, () => {
      const mark = document.createElement("mark");
      const moved = range.status === "MOVED";
      mark.className = `${moved ? "bg-orange-200" : "bg-yellow-200"} cursor-pointer`;
      mark.setAttribute("data-annotation-id", range.id);
      mark.setAttribute("data-status", range.status ?? "ACTIVE");
      if (moved) mark.title = "This comment moved when the document was edited.";
      return mark;
    });
  }
}

export function clearHighlights(container: HTMLElement): void {
  unwrapMarks(container, "mark[data-annotation-id]");
}

/**
 * Render other users' live selections as a separate mark layer. Operates
 * exclusively on mark[data-presence-user-id]; annotation marks are never
 * touched, so high-frequency presence churn can't thrash that layer.
 */
export function applyPresenceSelections(container: HTMLElement, selections: RemoteSelection[]): void {
  clearPresenceSelections(container);
  for (const sel of selections) {
    wrapRange(container, sel, () => {
      const mark = document.createElement("mark");
      mark.className = `${selectionColorFor(sel.userId)} rounded-sm`;
      mark.setAttribute("data-presence-user-id", sel.userId);
      mark.setAttribute("data-user-name", sel.name);
      mark.title = sel.name;
      return mark;
    });
  }
}

export function clearPresenceSelections(container: HTMLElement): void {
  unwrapMarks(container, "mark[data-presence-user-id]");
}

function unwrapMarks(container: HTMLElement, selector: string): void {
  const marks = container.querySelectorAll(selector);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function wrapRange(
  container: HTMLElement,
  range: { start: number; end: number },
  makeMark: () => HTMLElement,
): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    // Only handle ranges that fall entirely within a single text node.
    if (range.start >= offset && range.end <= offset + len && range.end > range.start) {
      const localStart = range.start - offset;
      const localEnd = range.end - offset;
      const domRange = document.createRange();
      domRange.setStart(node, localStart);
      domRange.setEnd(node, localEnd);
      try {
        domRange.surroundContents(makeMark());
      } catch {
        // Crosses an element boundary — fallback: no inline mark for this range.
      }
      return;
    }
    offset += len;
    node = walker.nextNode() as Text | null;
  }
}
