"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildQuote, relocate, type Quote } from "@/lib/anchoring";
import { applyHighlights, type HighlightRange } from "@/lib/highlight";
import CommentSidebar from "@/components/CommentSidebar";
import DocumentEditor from "@/components/DocumentEditor";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Card } from "@/components/ui/Card";
import { Badge, stateTone } from "@/components/ui/Badge";

export interface ClientComment {
  id: string;
  body: string;
  author?: { name?: string | null; email?: string | null } | null;
}
export interface ClientAnnotation {
  id: string;
  anchorExact: string | null;
  anchorPrefix: string | null;
  anchorSuffix: string | null;
  startOffset: number | null;
  endOffset: number | null;
  threadStatus: string;
  status: string;
  comments: ClientComment[];
}
export interface ClientDocument {
  id: string;
  title: string;
  state: string;
  versionNumber: number;
  markdown: string;
  annotations: ClientAnnotation[];
}

const STATE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  CLOSED: "Closed",
};

// Memoized so React never reconciles the rendered-markdown subtree after mount.
// `markdown` is constant for a v1 document (no in-app editing in part 1), which
// makes it safe for the highlight helper to mutate that DOM directly.
const RenderedMarkdown = memo(function RenderedMarkdown({ markdown }: { markdown: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>;
});

interface PendingSelection {
  quote: Quote;
  startOffset: number;
  endOffset: number;
}

export default function DocumentView({ doc }: { doc: ClientDocument }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<ClientAnnotation[]>(doc.annotations);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [pendingBody, setPendingBody] = useState("");
  const [docState, setDocState] = useState(doc.state);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"review" | "edit">("review");
  const [markdown, setMarkdown] = useState(doc.markdown);
  const [draft, setDraft] = useState(doc.markdown);
  const [versionNumber, setVersionNumber] = useState(doc.versionNumber);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, string>>({});

  // Capture text selections via selectionchange so both real pointer selection
  // and programmatic selection (Playwright selectText) are picked up.
  useEffect(() => {
    function onSelectionChange() {
      const sel = document.getSelection();
      const container = containerRef.current;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) return;
      const range = sel.getRangeAt(0);
      if (!container.contains(range.startContainer)) return;
      const selectedText = sel.toString();
      if (!selectedText.trim()) return;
      const pre = document.createRange();
      pre.selectNodeContents(container);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const end = start + selectedText.length;
      const containerText = container.textContent ?? "";
      setSelection({ quote: buildQuote(containerText, start, end), startOffset: start, endOffset: end });
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Re-apply highlights whenever the annotation set changes.
  useEffect(() => {
    if (mode !== "review") return;
    const container = containerRef.current;
    if (!container) return;
    const containerText = container.textContent ?? "";
    const ranges: HighlightRange[] = [];
    const statuses: Record<string, string> = {};
    for (const a of annotations) {
      const r = relocate(containerText, { exact: a.anchorExact ?? "", prefix: a.anchorPrefix ?? "", suffix: a.anchorSuffix ?? "" });
      statuses[a.id] = r.status;
      if (r.range) ranges.push({ id: a.id, start: r.range.start, end: r.range.end, status: r.status });
    }
    applyHighlights(container, ranges);
    setStatusById(statuses);
  }, [annotations, markdown, mode]);

  const onContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const mark = target.closest("mark[data-annotation-id]");
    if (mark) setFocusedId(mark.getAttribute("data-annotation-id"));
  }, []);

  async function submitComment() {
    if (!selection || !pendingBody.trim()) return;
    const res = await fetch(`/api/documents/${doc.id}/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote: selection.quote,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        body: pendingBody,
      }),
    });
    if (res.status === 201) {
      const { annotation } = await res.json();
      const created: ClientAnnotation = {
        id: annotation.id,
        anchorExact: annotation.anchorExact,
        anchorPrefix: annotation.anchorPrefix,
        anchorSuffix: annotation.anchorSuffix,
        startOffset: annotation.startOffset,
        endOffset: annotation.endOffset,
        threadStatus: annotation.threadStatus,
        status: annotation.status ?? "ACTIVE",
        comments: (annotation.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
      };
      setAnnotations((prev) => (prev.some((x) => x.id === created.id) ? prev : [...prev, created]));
      setSelection(null);
      setPendingBody("");
      setFocusedId(created.id);
    }
  }

  const refetchDetail = useCallback(async () => {
    const res = await fetch(`/api/documents/${doc.id}`);
    if (!res.ok) return;
    const { document } = await res.json();
    setMarkdown(document.currentVersion?.markdown ?? "");
    setVersionNumber(document.currentVersion?.versionNumber ?? versionNumber);
    setDocState(document.state);
    setAnnotations(
      document.annotations.map((a: ClientAnnotation) => ({
        id: a.id, anchorExact: a.anchorExact, anchorPrefix: a.anchorPrefix, anchorSuffix: a.anchorSuffix,
        startOffset: a.startOffset, endOffset: a.endOffset, threadStatus: a.threadStatus, status: a.status,
        comments: a.comments,
      }))
    );
  }, [doc.id, versionNumber]);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      es = new EventSource(`/api/documents/${doc.id}/stream`);
      es.onmessage = (ev) => {
        const e = JSON.parse(ev.data);
        if (e.type === "comment.created") {
          setAnnotations((prev) => prev.map((a) => a.id === e.annotationId && !a.comments.some((c) => c.id === e.comment.id) ? { ...a, comments: [...a.comments, { id: e.comment.id, body: e.comment.body, author: e.comment.author }] } : a));
        } else if (e.type === "annotation.created") {
          const a = e.annotation;
          setAnnotations((prev) => prev.some((x) => x.id === a.id) ? prev : [...prev, {
            id: a.id, anchorExact: a.anchorExact, anchorPrefix: a.anchorPrefix, anchorSuffix: a.anchorSuffix,
            startOffset: a.startOffset, endOffset: a.endOffset, threadStatus: a.threadStatus, status: a.status ?? "ACTIVE",
            comments: (a.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
          }]);
        } else if (e.type === "annotation.updated") {
          setAnnotations((prev) => prev.map((a) => a.id === e.annotationId ? { ...a, threadStatus: e.threadStatus ?? a.threadStatus } : a));
        } else if (e.type === "review.updated") {
          setDocState(e.state);
        } else if (e.type === "version.created") {
          refetchDetail();
        }
      };
      es.onerror = () => {
        es?.close();
        if (stopped) return;
        retry = setTimeout(() => { refetchDetail(); connect(); }, 2000);
      };
    }
    connect();
    return () => { stopped = true; es?.close(); if (retry) clearTimeout(retry); };
  }, [doc.id, refetchDetail]);

  async function saveVersion() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseVersionNumber: versionNumber, markdown: draft }),
      });
      if (res.status === 409) { setSaveError("This document changed since you opened the editor. Reload to get the latest."); return; }
      if (!res.ok) { setSaveError("Save failed."); return; }
      await refetchDetail();
      setMode("review");
    } finally {
      setSaving(false);
    }
  }

  const addComment = useCallback(async (annotationId: string, body: string) => {
    const res = await fetch(`/api/annotations/${annotationId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.status === 201) {
      const { comment } = await res.json();
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === annotationId && !a.comments.some((c) => c.id === comment.id)
            ? { ...a, comments: [...a.comments, { id: comment.id, body: comment.body, author: comment.author }] }
            : a
        )
      );
    }
  }, []);

  const toggleThread = useCallback(async (annotationId: string, nextStatus: string) => {
    const res = await fetch(`/api/annotations/${annotationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadStatus: nextStatus }),
    });
    if (res.ok) {
      setAnnotations((prev) => prev.map((a) => (a.id === annotationId ? { ...a, threadStatus: nextStatus } : a)));
    }
  }, []);

  async function submitReview(verdict: "APPROVE" | "REQUEST_CHANGES") {
    const res = await fetch(`/api/documents/${doc.id}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict }),
    });
    if (res.ok) {
      const { state } = await res.json();
      setDocState(state);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{doc.title}</h1>
          {mode === "review" && (
            <Button variant="secondary" size="sm" onClick={() => { setDraft(markdown); setMode("edit"); }}>Edit</Button>
          )}
        </div>
        {mode === "edit" ? (
          <DocumentEditor value={draft} onChange={setDraft} onSave={saveVersion} onCancel={() => { setDraft(markdown); setMode("review"); }} saving={saving} error={saveError} />
        ) : (
          <div
            ref={containerRef}
            data-testid="doc-body"
            onClick={onContainerClick}
            className="prose prose-violet max-w-none rounded-[var(--radius-app)] border border-border bg-surface p-6"
          >
            <RenderedMarkdown key={versionNumber} markdown={markdown} />
          </div>
        )}
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-80 lg:self-start lg:overflow-y-auto">
        <Card className="flex items-center justify-between gap-2 p-3">
          <Badge tone={stateTone(docState)} data-testid="doc-state">
            {STATE_LABELS[docState] ?? docState}
          </Badge>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => submitReview("APPROVE")}>
              Approve
            </Button>
            <Button variant="danger" size="sm" onClick={() => submitReview("REQUEST_CHANGES")}>
              Request changes
            </Button>
          </div>
        </Card>

        {selection && (
          <Card className="flex flex-col gap-2 p-3">
            <p className="text-xs text-muted">Commenting on: “{selection.quote.exact.slice(0, 60)}”</p>
            <Textarea
              aria-label="comment"
              value={pendingBody}
              onChange={(e) => setPendingBody(e.target.value)}
              rows={3}
              placeholder="Add a comment"
            />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={submitComment}>
                Comment
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelection(null);
                  setPendingBody("");
                }}
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}

        <CommentSidebar
          annotations={annotations}
          focusedId={focusedId}
          statusById={statusById}
          onSelectThread={setFocusedId}
          onAddComment={addComment}
          onToggleThread={toggleThread}
        />
      </aside>
    </div>
  );
}
