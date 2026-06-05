import Link from "next/link";
import { listDocuments } from "@/lib/documents";
import NewDocumentForm from "@/components/NewDocumentForm";

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
    <div className="mx-auto mt-12 flex w-full max-w-3xl flex-col gap-8 px-4">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Documents</h1>
        {documents.length === 0 ? (
          <p className="text-sm text-gray-500">No documents yet. Create one below.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded border">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={`/app/documents/${doc.id}`}
                  className="flex items-center justify-between gap-4 p-3 hover:bg-gray-50"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{doc.title}</span>
                    <span className="text-xs text-gray-500">{doc.owner?.name ?? doc.owner?.email}</span>
                  </span>
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs">
                    {STATE_LABELS[doc.state] ?? doc.state}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <NewDocumentForm />
    </div>
  );
}
