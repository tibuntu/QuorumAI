import { notFound } from "next/navigation";
import { getDocumentDetail } from "@/lib/documents";
import DocumentView, { type ClientDocument } from "@/components/DocumentView";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      comments: a.comments.map((c) => ({ id: c.id, body: c.body, author: c.author })),
    })),
  };

  return <DocumentView doc={serializable} />;
}
