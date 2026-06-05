import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { unreadCount } from "@/lib/notifications";
import { AppNav } from "@/components/AppNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const unread = await unreadCount(session.user.id);

  return (
    <div className="min-h-screen bg-background">
      <AppNav email={session.user.email} unread={unread} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
