import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { generateToken, listTokens } from "@/lib/tokens";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ tokens: await listTokens(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.label !== "string" || !body.label.trim()) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  const { id, token } = await generateToken(user.id, body.label.trim());
  return NextResponse.json({ id, token }, { status: 201 });
}
