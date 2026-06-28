"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";

type TokenRow = { id: string; label: string; lastUsedAt: Date | string | null; createdAt: Date | string };

export default function TokenManager({
  initialTokens,
  baseUrl,
}: {
  initialTokens: TokenRow[];
  baseUrl: string;
}) {
  const [tokens, setTokens] = useState<{ id: string; label: string; lastUsedAt: Date | string | null }[]>(initialTokens);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<number | "">("");
  const [scopes, setScopes] = useState<string[]>(["plans:write", "feedback:read"]);

  function toggleScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          expiresInDays: expiresInDays === "" ? undefined : expiresInDays,
          scopes,
        }),
      });
      if (res.status !== 201) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to create token");
        return;
      }
      const { id, token } = await res.json();
      setCreated(token);
      setTokens((prev) => [{ id, label, lastUsedAt: null }, ...prev]);
      setLabel("");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRevoke(id: string) {
    await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    setTokens((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">API tokens</h1>

      <Card className="p-4">
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm text-foreground">
            Label
            <Input
              aria-label="token label"
              placeholder="e.g. ci"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Expires
            <select
              aria-label="token expiry"
              className="rounded-[var(--radius-app)] border border-border bg-transparent px-2 py-2 text-sm accent-[var(--primary)]"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">365 days</option>
            </select>
          </label>
          <fieldset className="flex flex-col gap-1 text-sm text-foreground">
            <legend className="text-xs text-muted">Scopes</legend>
            {(["plans:write", "feedback:read"] as const).map((scope) => (
              <label key={scope} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={scope}
                  className="accent-[var(--primary)]"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                />
                {scope}
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={submitting || scopes.length === 0}>
            Create token
          </Button>
        </form>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-[var(--state-changes)]">
          {error}
        </p>
      )}

      {created && (
        <Card className="flex flex-col gap-2 border-[var(--state-approved)] p-4" style={{ background: "var(--state-approved-bg)" }}>
          <p className="text-sm font-medium text-foreground">Copy this token now — it won&apos;t be shown again.</p>
          <div className="flex gap-2">
            <Input
              data-testid="new-token"
              readOnly
              value={created}
              className="font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton value={created} className="shrink-0" />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCreated(null)} className="self-start">
            Done
          </Button>
        </Card>
      )}

      {tokens.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No tokens yet — create one above to call the API or use the /consensum-push-plan command.</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.map((t) => (
            <li key={t.id}>
              <Card className="flex items-center justify-between gap-4 p-3">
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{t.label}</span>
                  <span className="text-xs text-muted">
                    {t.lastUsedAt ? `Last used ${new Date(t.lastUsedAt).toLocaleString()}` : "Never used"}
                  </span>
                </span>
                <Button variant="danger" size="sm" onClick={() => onRevoke(t.id)}>
                  Revoke
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">CLI setup</h2>
          <CopyButton
            label="Copy commands"
            value={`export CONSENSUM_BASE_URL="${baseUrl || "http://localhost:3000"}"\nexport CONSENSUM_API_TOKEN="csm_…"   # the token shown above\n# /consensum-push-plan and /consensum-pull-feedback ship in this repo's dist/claude/commands/`}
          />
        </div>
        <pre className="overflow-x-auto rounded-[var(--radius-app)] border border-border bg-[var(--state-neutral-bg)] p-4 text-xs text-foreground">
{`export CONSENSUM_BASE_URL="${baseUrl || "http://localhost:3000"}"
export CONSENSUM_API_TOKEN="csm_…"   # the token shown above
# /consensum-push-plan and /consensum-pull-feedback ship in this repo's dist/claude/commands/`}
        </pre>
      </div>
    </section>
  );
}
