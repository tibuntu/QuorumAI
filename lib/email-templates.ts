export interface ActivityEvent { type: "comment" | "review" | "version"; actorName: string; }
export interface RenderInput { recipientName: string; docTitle: string; docId: string; events: ActivityEvent[]; }

const NOUN: Record<ActivityEvent["type"], [string, string]> = {
  comment: ["comment", "comments"],
  review: ["review", "reviews"],
  version: ["new version", "new versions"],
};

function baseUrl(): string { return (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, ""); }

function actorsPhrase(events: ActivityEvent[]): string {
  const names = [...new Set(events.map((e) => e.actorName))];
  if (names.length === 1) return names[0];
  const others = names.length - 1;
  return `${names[0]} and ${others} ${others === 1 ? "other" : "others"}`;
}

function countsPhrase(events: ActivityEvent[]): string {
  const byType = new Map<ActivityEvent["type"], number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  return [...byType.entries()]
    .map(([t, n]) => `${n} ${n === 1 ? NOUN[t][0] : NOUN[t][1]}`)
    .join(", ");
}

export function renderActivityEmail(input: RenderInput): { subject: string; html: string; text: string } {
  const url = `${baseUrl()}/app/documents/${input.docId}`;
  const counts = countsPhrase(input.events);
  const who = actorsPhrase(input.events);
  const total = input.events.length;
  const subject = total === 1
    ? `${input.docTitle}: ${counts}`
    : `${input.docTitle}: ${total} new updates`;
  const lead = `${who} left ${counts} on “${input.docTitle}”.`;
  const text = `Hi ${input.recipientName},\n\n${lead}\n\nReview it: ${url}\n\n— Quorum`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1e1b2e">
  <p>Hi ${escapeHtml(input.recipientName)},</p>
  <p>${escapeHtml(lead)}</p>
  <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#6d28d9;color:#fff;border-radius:8px;text-decoration:none">Open in Quorum</a></p>
  <p style="color:#6b6780;font-size:12px">You receive these because you're a participant on this document. Turn them off in Settings → Notifications.</p>
  </body></html>`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
