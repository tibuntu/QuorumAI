import type { HTMLAttributes } from "react";

export type Tone = "open" | "changes" | "approved" | "neutral";

const TONES: Record<Tone, string> = {
  open: "text-[var(--state-open)] bg-[var(--state-open-bg)]",
  changes: "text-[var(--state-changes)] bg-[var(--state-changes-bg)]",
  approved: "text-[var(--state-approved)] bg-[var(--state-approved-bg)]",
  neutral: "text-[var(--state-neutral)] bg-[var(--state-neutral-bg)]",
};

export function stateTone(state: string): Tone {
  if (state === "OPEN") return "open";
  if (state === "CHANGES_REQUESTED") return "changes";
  if (state === "APPROVED") return "approved";
  return "neutral";
}

export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}
