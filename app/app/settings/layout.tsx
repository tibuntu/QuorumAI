import Link from "next/link";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <nav className="mb-6 flex gap-4 text-sm" data-testid="settings-subnav">
        <Link href="/app/settings/notifications" className="text-foreground hover:text-primary">Notifications</Link>
        <Link href="/app/settings/tokens" className="text-foreground hover:text-primary">API tokens</Link>
      </nav>
      {children}
    </div>
  );
}
