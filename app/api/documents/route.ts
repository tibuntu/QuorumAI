import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { createDocument, listDocuments } from "@/lib/documents";
import { parseRequiredApprovals } from "@/lib/quorum";

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "title and markdown required" }, { status: 400 });
  }
  let requiredApprovals: number | undefined;
  if (body.requiredApprovals !== undefined) {
    const parsed = parseRequiredApprovals(body.requiredApprovals);
    if (parsed === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
    requiredApprovals = parsed;
  }
  const id = await createDocument(user.id, body.title, body.markdown, { requiredApprovals });
  return NextResponse.json({ id }, { status: 201 });
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ documents: await listDocuments(user.id) });
}
