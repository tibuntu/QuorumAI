import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { createDocument, listDocuments } from "@/lib/documents";

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "title and markdown required" }, { status: 400 });
  }
  const id = await createDocument(user.id, body.title, body.markdown);
  return NextResponse.json({ id }, { status: 201 });
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ documents: await listDocuments() });
}
