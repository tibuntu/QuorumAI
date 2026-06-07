import { notFound, redirect } from "next/navigation";
import { getDocumentDetail } from "@/lib/documents";
import { getSession } from "@/lib/session";
import { ensureParticipant } from "@/lib/authz";
import DocumentView, { type ClientDocument } from "@/components/DocumentView";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  if (!(await ensureParticipant(session.user.id, id))) notFound();
  const doc = await getDocumentDetail(id);
  if (!doc) notFound();

  const serializable: ClientDocument = {
    id: doc.id,
    title: doc.title,
    state: doc.state,
    versionNumber: doc.currentVersion?.versionNumber ?? 1,
    markdown: doc.currentVersion?.markdown ?? "",
    annotations: doc.annotations.map((a) => ({
      id: a.id,
      anchorExact: a.anchorExact,
      anchorPrefix: a.anchorPrefix,
      anchorSuffix: a.anchorSuffix,
      startOffset: a.startOffset,
      endOffset: a.endOffset,
      threadStatus: a.threadStatus,
      status: a.status,
      kind: a.kind,
      suggestedText: a.suggestedText,
      appliedInVersionNumber: a.appliedInVersion?.versionNumber ?? null,
      comments: a.comments.map((c) => ({ id: c.id, body: c.body, author: c.author })),
    })),
  };

  const isOwner = doc.ownerId === session.user.id;

  return <DocumentView doc={serializable} isOwner={isOwner} />;
}
