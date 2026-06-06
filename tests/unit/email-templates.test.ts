import { it, expect, beforeEach } from "vitest";
import { renderActivityEmail, type ActivityEvent } from "../../lib/email-templates";

beforeEach(() => { process.env.BETTER_AUTH_URL = "https://q.example"; });

const ev = (type: ActivityEvent["type"], actorName: string): ActivityEvent => ({ type, actorName });

it("single comment, single actor", () => {
  const out = renderActivityEmail({ recipientName: "Bo", docTitle: "Plan A", docId: "doc1", events: [ev("comment", "Al")] });
  expect(out.subject).toContain("Plan A");
  expect(out.subject.toLowerCase()).toContain("comment");
  expect(out.html).toContain("https://q.example/app/documents/doc1");
  expect(out.text).toContain("https://q.example/app/documents/doc1");
});

it("multiple events and actors", () => {
  const out = renderActivityEmail({ recipientName: "Bo", docTitle: "Plan A", docId: "doc1",
    events: [ev("comment", "Al"), ev("comment", "Cy"), ev("review", "Al")] });
  expect(out.subject).toMatch(/3|activity/i);
  expect(out.text).toMatch(/Al and 1 other|2 people/i);
});
