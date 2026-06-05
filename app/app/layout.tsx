import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { unreadCount } from "@/lib/notifications";
import { SignOutButton } from "@/components/SignOutButton";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const unread = await unreadCount(session.user.id);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b p-4">
        <span className="font-semibold">Quorum AI</span>
        <div className="flex items-center gap-4 text-sm">
          <a href="/app/inbox" data-testid="inbox-link" className="text-sm underline">
            Inbox{unread > 0 ? ` (${unread})` : ""}
          </a>
          <span data-testid="current-user">{session.user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
