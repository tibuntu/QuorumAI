import Link from "next/link";
import { listDocuments } from "@/lib/documents";
import NewDocumentForm from "@/components/NewDocumentForm";
import { Card } from "@/components/ui/Card";
import { Badge, stateTone } from "@/components/ui/Badge";
import { relativeTime } from "@/lib/time";

const STATE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  CLOSED: "Closed",
};

export default async function Home() {
  const documents = await listDocuments();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Documents</h1>
        {documents.length === 0 ? (
          <Card className="p-6 text-sm text-muted">
            No documents yet — create one below.
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {documents.map((doc) => (
              <Link key={doc.id} href={`/app/documents/${doc.id}`}>
                <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:bg-primary-subtle">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-foreground">{doc.title}</span>
                    <Badge tone={stateTone(doc.state)}>
                      {STATE_LABELS[doc.state] ?? doc.state}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted">
                    {doc.owner?.name ?? doc.owner?.email} · {relativeTime(doc.updatedAt)}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
      <Card className="p-6">
        <NewDocumentForm />
      </Card>
    </div>
  );
}
