import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { createVersion, ConcurrencyError } from "@/lib/versions";
import { isOwner } from "@/lib/authz";
import { maxPlanBytes } from "@/lib/config";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.markdown !== "string" || typeof body.baseVersionNumber !== "number") {
    return NextResponse.json({ error: "markdown and baseVersionNumber required" }, { status: 400 });
  }
  const maxBytes = maxPlanBytes();
  if (Buffer.byteLength(body.markdown, "utf8") > maxBytes) {
    return NextResponse.json({ error: `markdown exceeds ${maxBytes} bytes` }, { status: 413 });
  }
  try {
    const result = await createVersion(authd.user.id, id, body.baseVersionNumber, body.markdown);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ConcurrencyError) return NextResponse.json({ error: "stale version" }, { status: 409 });
    throw e;
  }
}
