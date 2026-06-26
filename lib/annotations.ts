import { prisma } from "@/lib/db";
import type { Quote } from "@/lib/anchoring";
import { relocate } from "@/lib/anchoring";
import { createVersion } from "@/lib/versions";
import type { AnnotationKind, Severity, ThreadStatus, Resolution } from "@/lib/enums";
import { publish } from "@/lib/events";
import { notifyParticipants } from "@/lib/notifications";
import { dispatch } from "@/lib/webhooks";

export async function createAnnotation(
  userId: string,
  documentId: string,
  anchor: { quote: Quote; startOffset: number; endOffset: number; kind?: AnnotationKind; severity?: Severity | null; category?: string | null; suggestedText?: string | null },
  body: string
) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  const annotation = await prisma.annotation.create({
    data: {
      documentId,
      createdOnVersionId: doc.currentVersionId,
      kind: anchor.kind ?? "COMMENT",
      anchorExact: anchor.quote.exact,
      anchorPrefix: anchor.quote.prefix,
      anchorSuffix: anchor.quote.suffix,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      severity: anchor.severity ?? null,
      category: anchor.category ?? null,
      suggestedText: anchor.kind === "SUGGESTION" ? (anchor.suggestedText ?? null) : null,
      authorId: userId,
      comments: { create: { authorId: userId, body } },
    },
    include: { comments: { include: { author: { select: { name: true, email: true } } } }, author: { select: { name: true, email: true } } },
  });
  publish(documentId, { type: "annotation.created", annotation });
  await notifyParticipants(documentId, userId, "comment").catch(() => {});
  await dispatch(documentId, "comment.created", { annotationId: annotation.id }, userId).catch(() => {});
  return annotation;
}

export async function addComment(userId: string, annotationId: string, body: string) {
  const comment = await prisma.comment.create({
    data: { annotationId, authorId: userId, body },
    include: { author: { select: { name: true, email: true } } },
  });
  const ann = await prisma.annotation.findUnique({ where: { id: annotationId }, select: { documentId: true } });
  if (ann) publish(ann.documentId, { type: "comment.created", annotationId, comment });
  if (ann) await notifyParticipants(ann.documentId, userId, "comment").catch(() => {});
  if (ann) await dispatch(ann.documentId, "comment.created", { annotationId }, userId).catch(() => {});
  return comment;
}

export async function setThreadStatus(userId: string, annotationId: string, status: ThreadStatus, resolution?: Resolution | null) {
  const annotation = await prisma.annotation.update({
    where: { id: annotationId },
    // Resolution reason is meaningful only while RESOLVED; reopening clears it.
    data: { threadStatus: status, resolution: status === "RESOLVED" ? (resolution ?? null) : null },
  });
  publish(annotation.documentId, { type: "annotation.updated", annotationId, threadStatus: status });
  await notifyParticipants(annotation.documentId, userId, "resolve").catch(() => {});
  return annotation;
}

export class OrphanedAnchorError extends Error {
  constructor(message = "anchor text no longer present") {
    super(message);
    this.name = "OrphanedAnchorError";
  }
}

/**
 * Owner-accepts a SUGGESTION: re-resolve its anchor against the *current*
 * markdown (D4), splice in `suggestedText`, and create a new version via the
 * existing createVersion() (which owns re-anchoring + approval dismissal — D2).
 * On success the thread is RESOLVED and `appliedInVersionId` records the result.
 *
 * Authorization (owner-only, D3) is enforced at the route, not here.
 */
export async function applySuggestion(userId: string, annotationId: string, baseVersionNumber: number) {
  const annotation = await prisma.annotation.findUnique({
    where: { id: annotationId },
    include: { document: { include: { currentVersion: true } } },
  });
  if (!annotation) throw new Error("annotation not found");
  if (annotation.kind !== "SUGGESTION") throw new Error("not a suggestion");
  if (annotation.suggestedText == null) throw new Error("suggestion has no proposed text");
  if (annotation.appliedInVersionId) throw new Error("suggestion already applied");
  if (annotation.threadStatus === "RESOLVED") throw new Error("suggestion thread is resolved");
  const current = annotation.document.currentVersion;
  if (!current) throw new Error("document has no current version");

  const reloc = relocate(current.markdown, {
    exact: annotation.anchorExact ?? "",
    prefix: annotation.anchorPrefix ?? "",
    suffix: annotation.anchorSuffix ?? "",
  });
  if (!reloc.range) throw new OrphanedAnchorError(); // range is null IFF status === "ORPHANED"

  const { start, end } = reloc.range;
  const newMarkdown = current.markdown.slice(0, start) + annotation.suggestedText + current.markdown.slice(end);

  const result = await createVersion(userId, annotation.documentId, baseVersionNumber, newMarkdown);

  // When the splice yields identical content (e.g. suggestedText === the existing
  // span), createVersion returns unchanged:true without re-checking baseVersionNumber.
  // Content-equality means the result is correct regardless of which version the
  // caller based on, so no extra stale-base guard is needed for this branch.
  const appliedVersionId = result.unchanged ? current.id : result.version.id;
  const appliedVersionNumber = result.unchanged ? current.versionNumber : result.version.versionNumber;

  const updated = await prisma.annotation.update({
    where: { id: annotationId },
    data: { appliedInVersionId: appliedVersionId, threadStatus: "RESOLVED", resolution: "FIXED" },
  });
  publish(annotation.documentId, { type: "annotation.updated", annotationId, threadStatus: "RESOLVED" });

  return { version: { id: appliedVersionId, versionNumber: appliedVersionNumber }, annotation: updated };
}
