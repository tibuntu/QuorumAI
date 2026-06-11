import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { NotificationSettings } from "@/components/NotificationSettings";
import { parsePrefs } from "@/lib/notification-prefs";

export default async function NotificationsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { notificationPrefs: true },
  });
  return <NotificationSettings initial={parsePrefs(user?.notificationPrefs)} />;
}
