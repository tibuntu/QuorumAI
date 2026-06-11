import { prisma } from "@/lib/db";
import { computeDocumentState } from "@/lib/review-state";
import type { ReviewVerdict } from "@/lib/enums";
import { publish } from "@/lib/events";
import { notifyParticipants } from "@/lib/notifications";
import { dispatch } from "@/lib/webhooks";

/**
 * Recompute the document's state from its current reviews + requiredApprovals,
 * persist it, and publish the SSE state change. Returns prev + new state so the
 * caller can decide whether to dispatch decision.changed. Shared by submitReview
 * and setRequiredApprovals.
 */
async function recomputeState(documentId: string): Promise<{ state: string; prevState: string }> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { requiredApprovals: true, state: true },
  });
  if (!doc) throw new Error("document not found");
  const prevState = doc.state;
  const reviews = await prisma.review.findMany({ where: { documentId } });
  const state = computeDocumentState(
    reviews.map((r) => ({ verdict: r.verdict as ReviewVerdict, dismissed: r.dismissed })),
    doc.requiredApprovals,
  );
  await prisma.document.update({ where: { id: documentId }, data: { state } });
  publish(documentId, { type: "review.updated", state });
  return { state, prevState };
}

export async function submitReview(userId: string, documentId: string, verdict: ReviewVerdict) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");

  // One active verdict per reviewer for the current version: replace any prior.
  await prisma.review.deleteMany({ where: { documentId, reviewerId: userId } });
  await prisma.review.create({ data: { documentId, reviewerId: userId, verdict, onVersionId: doc.currentVersionId } });

  const { state, prevState } = await recomputeState(documentId);
  await notifyParticipants(documentId, userId, "review").catch(() => {});
  await dispatch(documentId, "review.updated", { decision: state.toLowerCase() }, userId).catch(() => {});
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
  return state;
}

/**
 * Owner sets the approval threshold. Caller MUST have authorized owner + validated n (1–10).
 * Updates requiredApprovals, recomputes state, publishes review.updated, and dispatches
 * decision.changed on a flip. Does NOT notify participants (no new review occurred).
 */
export async function setRequiredApprovals(userId: string, documentId: string, n: number): Promise<string> {
  await prisma.document.update({ where: { id: documentId }, data: { requiredApprovals: n } });
  const { state, prevState } = await recomputeState(documentId);
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
  return state;
}
