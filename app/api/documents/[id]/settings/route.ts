import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant, isOwner } from "@/lib/authz";
import { parseRequiredApprovals } from "@/lib/quorum";
import { setRequiredApprovals } from "@/lib/reviews";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await isOwner(user.id, id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const n = parseRequiredApprovals(body?.requiredApprovals);
  if (n === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
  const state = await setRequiredApprovals(user.id, id, n);
  return NextResponse.json({ ok: true, requiredApprovals: n, state });
}
