import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { getDocumentDetail } from "@/lib/documents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const doc = await getDocumentDetail(id);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ document: doc });
}
