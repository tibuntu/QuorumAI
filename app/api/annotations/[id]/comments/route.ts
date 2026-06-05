import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { addComment } from "@/lib/annotations";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.body !== "string") {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  const comment = await addComment(user.id, id, body.body);
  return NextResponse.json({ comment }, { status: 201 });
}
