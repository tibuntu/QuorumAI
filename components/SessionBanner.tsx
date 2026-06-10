"use client";
import { Button } from "@/components/ui/Button";
import type { ReviewSession } from "@/lib/events";
import { isLeader, isInSession, canStart } from "@/lib/session-client";
import type { SessionAction } from "@/lib/enums";

export default function SessionBanner({
  session,
  currentUserId,
  onAction,
  pending,
  followAttached,
  onResumeFollow,
}: {
  session: ReviewSession | null;
  currentUserId: string;
  onAction: (action: SessionAction) => void;
  pending: boolean;
  followAttached: boolean;
  onResumeFollow: () => void;
}) {
  if (canStart(session)) {
    return (
      <Button
        variant="secondary"
        size="sm"
        data-testid="start-session"
        title="Start a review session: others can join and follow your scroll position as you walk through the document."
        disabled={pending}
        onClick={() => onAction("start")}
      >
        Start session
      </Button>
    );
  }

  const s = session!;
  const leader = isLeader(s, currentUserId);
  const joined = isInSession(s, currentUserId);
  const count = s.participants.length;

  return (
    <div
      data-testid="session-banner"
      className="flex items-center gap-2 rounded-[var(--radius-app)] border border-border bg-surface px-3 py-1 text-sm"
    >
      {leader ? (
        <span>
          You&apos;re leading · <span data-testid="session-participant-count">{count}</span> participant
          {count === 1 ? "" : "s"}
        </span>
      ) : (
        <span>
          <span data-testid="session-leader-name">{s.leaderName}</span> is leading a review session ·{" "}
          <span data-testid="session-participant-count">{count}</span> in session
        </span>
      )}
      {joined && !leader &&
        (followAttached ? (
          <span
            data-testid="following-indicator"
            className="text-muted"
            title={`Your view follows ${s.leaderName}'s scroll position. Scroll manually to detach.`}
          >
            Following {s.leaderName}
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            data-testid="resume-following"
            title={`Re-attach to ${s.leaderName}'s view and follow their scrolling again.`}
            disabled={pending}
            onClick={onResumeFollow}
          >
            Jump back to {s.leaderName} · Resume
          </Button>
        ))}
      {leader ? (
        <Button variant="danger" size="sm" data-testid="end-session" disabled={pending} onClick={() => onAction("end")}>
          End session
        </Button>
      ) : joined ? (
        <Button variant="secondary" size="sm" data-testid="leave-session" disabled={pending} onClick={() => onAction("leave")}>
          Leave
        </Button>
      ) : (
        <Button variant="secondary" size="sm" data-testid="join-session" title={`Join ${s.leaderName}'s review session and follow their scroll position.`} disabled={pending} onClick={() => onAction("join")}>
          Join
        </Button>
      )}
    </div>
  );
}
