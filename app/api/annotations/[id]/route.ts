import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { setThreadStatus } from "@/lib/annotations";
import { THREAD_STATUSES, type ThreadStatus } from "@/lib/enums";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !THREAD_STATUSES.includes(body.threadStatus as ThreadStatus)) {
    return NextResponse.json({ error: "valid threadStatus required" }, { status: 400 });
  }
  const annotation = await setThreadStatus(user.id, id, body.threadStatus as ThreadStatus);
  return NextResponse.json({ annotation });
}
