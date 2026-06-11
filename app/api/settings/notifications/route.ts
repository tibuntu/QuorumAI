import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parsePrefs, applyPatch, isValidCell } from "@/lib/notification-prefs";
import type { NotificationType, NotificationChannel } from "@/lib/enums";

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { type, channel, enabled } = body as { type?: unknown; channel?: unknown; enabled?: unknown };

  if (
    typeof type !== "string" ||
    typeof channel !== "string" ||
    typeof enabled !== "boolean" ||
    !isValidCell(type, channel)
  ) {
    return NextResponse.json(
      { error: "body must be { type, channel, enabled } for a valid notification cell" },
      { status: 400 },
    );
  }

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { notificationPrefs: true } });
  const prefs = applyPatch(
    parsePrefs(row?.notificationPrefs),
    type as NotificationType,
    channel as NotificationChannel,
    enabled,
  );
  await prisma.user.update({ where: { id: user.id }, data: { notificationPrefs: prefs } });
  return NextResponse.json({ ok: true, prefs });
}
