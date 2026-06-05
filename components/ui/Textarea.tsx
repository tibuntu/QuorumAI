import type { TextareaHTMLAttributes } from "react";
export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-[var(--radius-app)] border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/30 ${className}`}
      {...props}
    />
  );
}
