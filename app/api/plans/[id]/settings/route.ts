import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { isOwner } from "@/lib/authz";
import { parseRequiredApprovals } from "@/lib/quorum";
import { setRequiredApprovals } from "@/lib/reviews";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const n = parseRequiredApprovals(body?.requiredApprovals);
  if (n === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
  const state = await setRequiredApprovals(authd.user.id, id, n);
  return NextResponse.json({ requiredApprovals: n, state });
}
