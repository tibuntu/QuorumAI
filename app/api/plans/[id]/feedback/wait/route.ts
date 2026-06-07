import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { isOwner } from "@/lib/authz";
import { clampTimeout, waitForFeedbackChange } from "@/lib/feedback-wait";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_MS = 60000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("feedback:read")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });

  const envMax = Number(process.env.FEEDBACK_WAIT_MAX_MS);
  const maxMs = Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_MS;
  const raw = new URL(req.url).searchParams.get("timeoutMs");
  const requested = raw === null ? undefined : Number(raw);
  const timeoutMs = clampTimeout(requested, maxMs, DEFAULT_TIMEOUT_MS);

  const result = await waitForFeedbackChange(id, timeoutMs);
  if (result === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
