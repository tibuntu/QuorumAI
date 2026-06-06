"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";

const LINKS = [
  { href: "/app", label: "Documents", testid: undefined as string | undefined },
  { href: "/app/inbox", label: "Inbox", testid: "inbox-link" },
  { href: "/app/settings/tokens", label: "Settings", testid: undefined },
];

export function AppNav({ email, unread }: { email: string; unread: number }) {
  const pathname = usePathname();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/app" className="font-semibold text-foreground">◆ Quorum</Link>
          <nav className="flex items-center gap-1 text-sm">
            {LINKS.map((l) => {
              const active = l.href === "/app" ? pathname === "/app" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  data-testid={l.testid}
                  className={`rounded-md px-2.5 py-1.5 ${active ? "bg-primary-subtle text-primary" : "text-muted hover:text-foreground"}`}
                >
                  {l.label}
                  {l.href === "/app/inbox" && unread > 0 && (
                    <span className="ml-1.5 rounded-full bg-danger px-1.5 text-xs text-danger-fg">{unread}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span data-testid="current-user" className="max-w-[45vw] truncate text-muted sm:max-w-[220px] md:max-w-none">{email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
