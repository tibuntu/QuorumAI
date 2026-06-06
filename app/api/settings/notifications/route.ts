import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.emailNotifications !== "boolean") {
    return NextResponse.json({ error: "emailNotifications must be boolean" }, { status: 400 });
  }
  await prisma.user.update({ where: { id: user.id }, data: { emailNotifications: body.emailNotifications } });
  return NextResponse.json({ ok: true, emailNotifications: body.emailNotifications });
}
