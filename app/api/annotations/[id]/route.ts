import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { setThreadStatus } from "@/lib/annotations";
import { THREAD_STATUSES, type ThreadStatus, RESOLUTIONS, type Resolution } from "@/lib/enums";
import { documentIdForAnnotation, isParticipant } from "@/lib/authz";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const documentId = await documentIdForAnnotation(id);
  if (!documentId || !(await isParticipant(user.id, documentId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !THREAD_STATUSES.includes(body.threadStatus as ThreadStatus)) {
    return NextResponse.json({ error: "valid threadStatus required" }, { status: 400 });
  }
  let resolution: Resolution | undefined;
  if (body.resolution != null) {
    if (typeof body.resolution !== "string" || !RESOLUTIONS.includes(body.resolution as Resolution)) {
      return NextResponse.json({ error: `resolution must be one of ${RESOLUTIONS.join(", ")}` }, { status: 400 });
    }
    resolution = body.resolution as Resolution;
  }
  const annotation = await setThreadStatus(user.id, id, body.threadStatus as ThreadStatus, resolution);
  return NextResponse.json({ annotation });
}
