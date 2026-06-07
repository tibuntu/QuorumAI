import { prisma } from "@/lib/db";
import { computeDocumentState } from "@/lib/review-state";
import type { ReviewVerdict } from "@/lib/enums";
import { publish } from "@/lib/events";
import { notifyParticipants } from "@/lib/notifications";
import { dispatch } from "@/lib/webhooks";

export async function submitReview(userId: string, documentId: string, verdict: ReviewVerdict) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true, requiredApprovals: true, state: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  const prevState = doc.state;

  // One active verdict per reviewer for the current version: replace any prior.
  await prisma.review.deleteMany({ where: { documentId, reviewerId: userId } });
  await prisma.review.create({ data: { documentId, reviewerId: userId, verdict, onVersionId: doc.currentVersionId } });

  const reviews = await prisma.review.findMany({ where: { documentId } });
  const state = computeDocumentState(reviews.map((r) => ({ verdict: r.verdict as ReviewVerdict, dismissed: r.dismissed })), doc.requiredApprovals);
  await prisma.document.update({ where: { id: documentId }, data: { state } });
  publish(documentId, { type: "review.updated", state });
  await notifyParticipants(documentId, userId, "review").catch(() => {});
  await dispatch(documentId, "review.updated", { decision: state.toLowerCase() }, userId).catch(() => {});
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
  return state;
}
