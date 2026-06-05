import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { revokeToken } from "@/lib/tokens";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await revokeToken(user.id, id);
  return NextResponse.json({ ok: true });
}
