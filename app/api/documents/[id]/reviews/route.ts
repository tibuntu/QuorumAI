import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { submitReview } from "@/lib/reviews";
import { REVIEW_VERDICTS, type ReviewVerdict } from "@/lib/enums";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !REVIEW_VERDICTS.includes(body.verdict as ReviewVerdict)) {
    return NextResponse.json({ error: "valid verdict required" }, { status: 400 });
  }
  const state = await submitReview(user.id, id, body.verdict as ReviewVerdict);
  return NextResponse.json({ state });
}
