"use client";
import { useState } from "react";

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

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
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
      <h1 className="text-2xl font-semibold">API tokens</h1>

      <form onSubmit={onCreate} className="flex items-end gap-3 rounded border p-4">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Label
          <input
            aria-label="token label"
            placeholder="e.g. ci"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="border p-2"
          />
        </label>
        <button type="submit" disabled={submitting} className="bg-black p-2 text-white disabled:opacity-50">
          Create token
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {created && (
        <div className="flex flex-col gap-2 rounded border border-green-600 bg-green-50 p-4">
          <p className="text-sm font-medium">Copy this token now — it won&apos;t be shown again.</p>
          <input
            data-testid="new-token"
            readOnly
            value={created}
            className="border p-2 font-mono text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button onClick={() => setCreated(null)} className="self-start text-sm underline">
            Done
          </button>
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="text-sm text-gray-500">No tokens yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 p-3">
              <span className="flex flex-col">
                <span className="font-medium">{t.label}</span>
                <span className="text-xs text-gray-500">
                  {t.lastUsedAt ? `Last used ${new Date(t.lastUsedAt).toLocaleString()}` : "Never used"}
                </span>
              </span>
              <button onClick={() => onRevoke(t.id)} className="text-sm text-red-600 underline">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">CLI setup</h2>
        <pre className="overflow-x-auto rounded border bg-gray-50 p-4 text-xs">
{`export QUORUM_BASE_URL="${baseUrl || "http://localhost:3000"}"
export QUORUM_API_TOKEN="qai_…"   # the token shown above
# /push-plan and /pull-feedback ship in this repo's .claude/commands/`}
        </pre>
      </div>
    </section>
  );
}
