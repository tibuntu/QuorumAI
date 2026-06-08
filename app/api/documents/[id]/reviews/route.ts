import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { submitReview } from "@/lib/reviews";
import { REVIEW_VERDICTS, type ReviewVerdict } from "@/lib/enums";
import { isOwner, isParticipant } from "@/lib/authz";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (await isOwner(user.id, id)) {
    return NextResponse.json({ error: "owners cannot review their own document" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !REVIEW_VERDICTS.includes(body.verdict as ReviewVerdict)) {
    return NextResponse.json({ error: "valid verdict required" }, { status: 400 });
  }
  const state = await submitReview(user.id, id, body.verdict as ReviewVerdict);
  return NextResponse.json({ state });
}
