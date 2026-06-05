import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { createVersion, ConcurrencyError } from "@/lib/versions";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.markdown !== "string" || typeof body.baseVersionNumber !== "number") {
    return NextResponse.json({ error: "markdown and baseVersionNumber required" }, { status: 400 });
  }
  try {
    const result = await createVersion(user.id, id, body.baseVersionNumber, body.markdown);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ConcurrencyError) return NextResponse.json({ error: "stale version" }, { status: 409 });
    throw e;
  }
}
