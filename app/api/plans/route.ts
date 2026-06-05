import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { createDocument } from "@/lib/documents";

export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "title and markdown required" }, { status: 400 });
  }
  const agentContext = typeof body.agentContext === "string" ? body.agentContext : undefined;
  const id = await createDocument(user.id, body.title, body.markdown, { source: "CLAUDE_CODE", agentContext });
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return NextResponse.json({ id, reviewUrl: `${base}/app/documents/${id}` }, { status: 201 });
}
