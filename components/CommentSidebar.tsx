"use client";
import { useState } from "react";
import type { ClientAnnotation } from "@/components/DocumentView";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";

function authorLabel(author?: { name?: string | null; email?: string | null } | null): string {
  return author?.name ?? author?.email ?? "You";
}

function ThreadCard({
  annotation,
  status,
  focused,
  onSelect,
  onAddComment,
  onToggleThread,
}: {
  annotation: ClientAnnotation;
  status?: string;
  focused: boolean;
  onSelect: (id: string) => void;
  onAddComment: (annotationId: string, body: string) => Promise<void>;
  onToggleThread: (annotationId: string, nextStatus: string) => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const resolved = annotation.threadStatus === "RESOLVED";

  async function submitReply() {
    if (!reply.trim()) return;
    await onAddComment(annotation.id, reply);
    setReply("");
  }

  return (
    <Card
      data-testid="thread"
      onClick={() => onSelect(annotation.id)}
      className={`flex cursor-pointer flex-col gap-2 p-3 ${resolved ? "opacity-50" : ""} ${focused ? "ring-2 ring-primary/40" : ""}`}
    >
      {annotation.anchorExact && (
        <p className="border-l-2 border-[var(--state-open)] pl-2 text-xs italic text-muted">
          &ldquo;{annotation.anchorExact.slice(0, 80)}&rdquo;
          {status === "MOVED" && <span className="text-xs text-[var(--state-open)]"> moved</span>}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {annotation.comments.map((c) => (
          <li key={c.id} className="text-sm text-foreground">
            <span className="font-medium">{authorLabel(c.author)}: </span>
            {c.body}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1">
        <Textarea
          aria-label="reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder="Reply"
        />
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={submitReply}>
            Reply
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onToggleThread(annotation.id, resolved ? "OPEN" : "RESOLVED")}
          >
            {resolved ? "Reopen" : "Resolve"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function CommentSidebar({
  annotations,
  focusedId,
  statusById,
  onSelectThread,
  onAddComment,
  onToggleThread,
}: {
  annotations: ClientAnnotation[];
  focusedId: string | null;
  statusById: Record<string, string>;
  onSelectThread: (id: string) => void;
  onAddComment: (annotationId: string, body: string) => Promise<void>;
  onToggleThread: (annotationId: string, nextStatus: string) => Promise<void>;
}) {
  const orphaned = annotations.filter((a) => statusById[a.id] === "ORPHANED");
  const live = annotations.filter((a) => statusById[a.id] !== "ORPHANED");

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-muted">Comments</h2>
      {live.length === 0 && orphaned.length === 0 ? (
        <p className="text-sm text-muted">Select text in the document to add a comment.</p>
      ) : (
        <>
          {live.map((a) => (
            <ThreadCard
              key={a.id}
              annotation={a}
              status={statusById[a.id]}
              focused={focusedId === a.id}
              onSelect={onSelectThread}
              onAddComment={onAddComment}
              onToggleThread={onToggleThread}
            />
          ))}
          {orphaned.length > 0 && (
            <div data-testid="orphaned-section" className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase text-muted">Orphaned comments</h3>
              {orphaned.map((a) => (
                <ThreadCard key={a.id} annotation={a} status="ORPHANED" focused={focusedId === a.id}
                  onSelect={onSelectThread} onAddComment={onAddComment} onToggleThread={onToggleThread} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
