import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { listNotifications, markRead, markAllRead } from "@/lib/notifications";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ notifications: await listNotifications(user.id) });
}

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body?.all === true) { await markAllRead(user.id); return NextResponse.json({ ok: true }); }
  if (typeof body?.id === "string") { await markRead(user.id, body.id); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "id or all required" }, { status: 400 });
}
