"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildQuote, type Quote } from "@/lib/anchoring";
import { applyHighlights, buildHighlightRanges } from "@/lib/highlight";
import { applyPresenceEvent } from "@/lib/presence-client";
import PresenceRoster from "@/components/PresenceRoster";
import type { PresenceEntry, PresenceSelection } from "@/lib/events";
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
  kind: string;
  suggestedText: string | null;
  appliedInVersionNumber: number | null;
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

export default function DocumentView({ doc, isOwner, editEnabled, currentUserId, currentUserName }: { doc: ClientDocument; isOwner: boolean; editEnabled: boolean; currentUserId: string; currentUserName: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<ClientAnnotation[]>(doc.annotations);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [pendingBody, setPendingBody] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestDraft, setSuggestDraft] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [docState, setDocState] = useState(doc.state);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"review" | "edit">("review");
  const [markdown, setMarkdown] = useState(doc.markdown);
  const [draft, setDraft] = useState(doc.markdown);
  const [versionNumber, setVersionNumber] = useState(doc.versionNumber);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [roster, setRoster] = useState<PresenceEntry[]>(() => [
    { userId: currentUserId, name: currentUserName, lastSeen: Date.now() },
  ]);

  const selectionRef = useRef<PresenceSelection | null>(null);
  const versionRef = useRef(versionNumber);
  useEffect(() => {
    versionRef.current = versionNumber;
  }, [versionNumber]);

  // One presence channel for heartbeats AND selection updates: every POST
  // states the full selection truth (object sets, null clears).
  const sendPresence = useCallback(() => {
    fetch(`/api/documents/${doc.id}/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: selectionRef.current }),
      keepalive: true,
    }).catch(() => {});
  }, [doc.id]);

  // Leading+trailing throttle so drag-selections feel live without spamming.
  const throttleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const queueSelectionSend = useCallback(() => {
    const throttleMs = Number(process.env.NEXT_PUBLIC_PRESENCE_SELECTION_THROTTLE_MS ?? 250);
    const t = throttleRef.current;
    const elapsed = Date.now() - t.last;
    if (elapsed >= throttleMs) {
      t.last = Date.now();
      sendPresence();
    } else if (!t.timer) {
      t.timer = setTimeout(() => {
        t.timer = null;
        t.last = Date.now();
        sendPresence();
      }, throttleMs - elapsed);
    }
  }, [sendPresence]);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (res.ok) { router.push("/app"); return; }
    setDeleting(false);
    setConfirmingDelete(false);
  }

  // Capture text selections via selectionchange so both real pointer selection
  // and programmatic selection (Playwright selectText) are picked up.
  useEffect(() => {
    function onSelectionChange() {
      const sel = document.getSelection();
      const container = containerRef.current;
      const clearShared = () => {
        // Only send on the transition to "no selection" — collapsing focus on
        // other UI (e.g. the comment composer) must not burn redundant POSTs.
        if (selectionRef.current !== null) {
          selectionRef.current = null;
          queueSelectionSend();
        }
      };
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) return clearShared();
      const range = sel.getRangeAt(0);
      if (!container.contains(range.startContainer)) return clearShared();
      const selectedText = sel.toString();
      if (!selectedText.trim()) return clearShared();
      const pre = document.createRange();
      pre.selectNodeContents(container);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const end = start + selectedText.length;
      const containerText = container.textContent ?? "";
      setSelection({ quote: buildQuote(containerText, start, end), startOffset: start, endOffset: end });
      selectionRef.current = { start, end, versionNumber: versionRef.current };
      queueSelectionSend();
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [queueSelectionSend]);

  // Re-apply highlights whenever the annotation set changes.
  useEffect(() => {
    if (mode !== "review") return;
    const container = containerRef.current;
    if (!container) return;
    const { ranges, statuses } = buildHighlightRanges(container.textContent ?? "", annotations);
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
        kind: annotation.kind ?? "COMMENT",
        suggestedText: annotation.suggestedText ?? null,
        appliedInVersionNumber: null,
        comments: (annotation.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
      };
      setAnnotations((prev) => (prev.some((x) => x.id === created.id) ? prev : [...prev, created]));
      setSelection(null);
      setPendingBody("");
      setFocusedId(created.id);
    }
  }

  async function submitSuggestion() {
    if (!selection || !suggestDraft.trim()) return;
    const res = await fetch(`/api/documents/${doc.id}/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote: selection.quote,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        body: pendingBody.trim() || "Suggested edit",
        kind: "SUGGESTION",
        suggestedText: suggestDraft,
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
        kind: annotation.kind ?? "SUGGESTION",
        suggestedText: annotation.suggestedText ?? null,
        appliedInVersionNumber: null,
        comments: (annotation.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
      };
      setAnnotations((prev) => (prev.some((x) => x.id === created.id) ? prev : [...prev, created]));
      setSelection(null);
      setPendingBody("");
      setSuggesting(false);
      setSuggestDraft("");
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
      document.annotations.map((a: ClientAnnotation & { appliedInVersion?: { versionNumber: number } | null }) => ({
        id: a.id, anchorExact: a.anchorExact, anchorPrefix: a.anchorPrefix, anchorSuffix: a.anchorSuffix,
        startOffset: a.startOffset, endOffset: a.endOffset, threadStatus: a.threadStatus, status: a.status,
        kind: a.kind ?? "COMMENT", suggestedText: a.suggestedText ?? null,
        appliedInVersionNumber: a.appliedInVersion?.versionNumber ?? a.appliedInVersionNumber ?? null,
        comments: a.comments,
      }))
    );
  }, [doc.id, versionNumber]);

  const applySuggestion = useCallback(async (annotationId: string) => {
    setApplyError(null);
    const res = await fetch(`/api/annotations/${annotationId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseVersionNumber: versionNumber }),
    });
    if (res.status === 409) {
      setApplyError("This document changed since you opened it. Reloading the latest.");
      await refetchDetail();
      return;
    }
    if (res.status === 422) {
      setApplyError("Can't apply — the suggested text's anchor changed. Reject and re-request.");
      return;
    }
    if (!res.ok) {
      setApplyError("Apply failed.");
      return;
    }
    await refetchDetail();
  }, [versionNumber, refetchDetail]);

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
            kind: a.kind ?? "COMMENT", suggestedText: a.suggestedText ?? null, appliedInVersionNumber: null,
            comments: (a.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
          }]);
        } else if (e.type === "annotation.updated") {
          setAnnotations((prev) => prev.map((a) => a.id === e.annotationId ? { ...a, threadStatus: e.threadStatus ?? a.threadStatus } : a));
        } else if (e.type === "review.updated") {
          setDocState(e.state);
        } else if (e.type === "version.created") {
          refetchDetail();
        } else if (e.type === "presence.sync" || e.type === "presence.updated" || e.type === "presence.left") {
          setRoster((prev) => applyPresenceEvent(prev, e, { userId: currentUserId, name: currentUserName }));
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
  }, [doc.id, refetchDetail, currentUserId, currentUserName]);

  // Presence heartbeat: ride a throttled POST beacon (NOT a third EventSource).
  useEffect(() => {
    const url = `/api/documents/${doc.id}/presence`;
    const throttle = throttleRef.current;
    const leave = () => {
      const blob = new Blob([JSON.stringify({ leaving: true })], { type: "application/json" });
      navigator.sendBeacon?.(url, blob);
    };
    sendPresence();
    const intervalMs = Number(process.env.NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS ?? 10_000);
    // Interval heartbeats bypass the selection throttle bookkeeping on purpose:
    // they are keep-alives, not selection sends, so they never delay one.
    const timer = setInterval(sendPresence, intervalMs);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      if (throttle.timer) {
        clearTimeout(throttle.timer);
        throttle.timer = null;
      }
      window.removeEventListener("pagehide", leave);
      leave(); // best-effort fast departure on unmount
    };
  }, [doc.id, sendPresence]);

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
      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <Card className="max-w-md space-y-4 p-6">
            <h2 className="text-lg font-semibold text-foreground">Delete this document?</h2>
            <p className="text-sm text-muted">
              This permanently removes the document and all its comments, versions, and reviews. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setConfirmingDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" disabled={deleting} data-testid="confirm-delete" onClick={handleDelete}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </Card>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{doc.title}</h1>
          <PresenceRoster roster={roster} currentUserId={currentUserId} />
          {mode === "review" && editEnabled && (
            <Button variant="secondary" size="sm" onClick={() => { setDraft(markdown); setMode("edit"); }}>Edit</Button>
          )}
          <Link href={`/app/documents/${doc.id}/history`} data-testid="history-link" className="text-sm text-primary hover:underline">History</Link>
          {isOwner && (
            <Button variant="danger" size="sm" data-testid="delete-document" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
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
          {!isOwner && (
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => submitReview("APPROVE")}>
                Approve
              </Button>
              <Button variant="danger" size="sm" onClick={() => submitReview("REQUEST_CHANGES")}>
                Request changes
              </Button>
            </div>
          )}
        </Card>

        {selection && (
          <Card className="flex flex-col gap-2 p-3">
            <p className="text-xs text-muted">
              {suggesting ? "Suggesting an edit to" : "Commenting on"}: “{selection.quote.exact.slice(0, 60)}”
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant={suggesting ? "secondary" : "primary"}
                size="sm"
                onClick={() => {
                  if (suggesting) {
                    setSuggesting(false);
                    setSuggestDraft("");
                  } else {
                    setSuggesting(true);
                    setSuggestDraft(selection.quote.exact);
                  }
                }}
              >
                {suggesting ? "Switch to comment" : "Suggest edit"}
              </Button>
            </div>
            {suggesting && (
              <Textarea
                aria-label="proposed text"
                value={suggestDraft}
                onChange={(e) => setSuggestDraft(e.target.value)}
                rows={3}
                placeholder="Proposed text"
              />
            )}
            <Textarea
              aria-label="comment"
              value={pendingBody}
              onChange={(e) => setPendingBody(e.target.value)}
              rows={3}
              placeholder={suggesting ? "Rationale (optional)" : "Add a comment"}
            />
            <div className="flex gap-2">
              {suggesting ? (
                <Button variant="primary" size="sm" onClick={submitSuggestion} disabled={!suggestDraft.trim()}>
                  Suggest
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={submitComment}>
                  Comment
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelection(null);
                  setPendingBody("");
                  setSuggesting(false);
                  setSuggestDraft("");
                }}
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {applyError && <p className="text-sm text-danger">{applyError}</p>}

        <CommentSidebar
          annotations={annotations}
          focusedId={focusedId}
          statusById={statusById}
          isOwner={isOwner}
          onSelectThread={setFocusedId}
          onAddComment={addComment}
          onToggleThread={toggleThread}
          onApplySuggestion={applySuggestion}
        />
      </aside>
    </div>
  );
}
