import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { getPlanFeedback } from "@/lib/feedback";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const feedback = await getPlanFeedback(id);
  if (!feedback) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(feedback);
}
