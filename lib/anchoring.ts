import type { AnchorStatus } from "@/lib/enums";

export interface Quote {
  exact: string;
  prefix: string;
  suffix: string;
}
export interface TextRange {
  start: number;
  end: number;
}

const CONTEXT = 32;

export function buildQuote(text: string, start: number, end: number): Quote {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, Math.min(text.length, end + CONTEXT)),
  };
}

/** Locate the quote in `text`. Exact-unique → that range; repeated → best context match; absent → null. */
export function locate(text: string, quote: Quote): TextRange | null {
  if (!quote.exact) return null;
  const occurrences = indexesOf(text, quote.exact);
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) {
    return { start: occurrences[0], end: occurrences[0] + quote.exact.length };
  }
  let best: { idx: number; score: number } | null = null;
  for (const idx of occurrences) {
    const pre = text.slice(Math.max(0, idx - quote.prefix.length), idx);
    const suf = text.slice(idx + quote.exact.length, idx + quote.exact.length + quote.suffix.length);
    const score = commonSuffixLen(pre, quote.prefix) + commonPrefixLen(suf, quote.suffix);
    if (!best || score > best.score) best = { idx, score };
  }
  return best ? { start: best.idx, end: best.idx + quote.exact.length } : null;
}

function indexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

export const FUZZY_THRESHOLD = 0.7;

export interface Relocation {
  status: AnchorStatus;
  range: TextRange | null;
}

/** Re-locate a quote in (possibly edited) text: exact → ACTIVE, fuzzy → MOVED, none → ORPHANED. */
export function relocate(text: string, quote: Quote, opts?: { threshold?: number }): Relocation {
  const exact = locate(text, quote);
  if (exact) return { status: "ACTIVE", range: exact };
  const fuzzy = locateFuzzy(text, quote, opts?.threshold ?? FUZZY_THRESHOLD);
  if (fuzzy) return { status: "MOVED", range: fuzzy };
  return { status: "ORPHANED", range: null };
}

function locateFuzzy(text: string, quote: Quote, threshold: number): TextRange | null {
  const needle = quote.exact;
  const window = needle.length;
  if (window === 0 || window > text.length) return null;
  let best: { start: number; sim: number; ctx: number } | null = null;
  for (let i = 0; i + window <= text.length; i++) {
    const candidate = text.slice(i, i + window);
    const sim = similarity(needle, candidate);
    if (sim < threshold) continue;
    const pre = text.slice(Math.max(0, i - quote.prefix.length), i);
    const suf = text.slice(i + window, i + window + quote.suffix.length);
    const ctxDenom = quote.prefix.length + quote.suffix.length || 1;
    const ctx = (commonSuffixLen(pre, quote.prefix) + commonPrefixLen(suf, quote.suffix)) / ctxDenom;
    if (!best || sim > best.sim || (sim === best.sim && ctx > best.ctx)) best = { start: i, sim, ctx };
  }
  return best ? { start: best.start, end: best.start + window } : null;
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
