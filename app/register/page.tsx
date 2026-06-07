"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth-client";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const oidcEnabled = process.env.NEXT_PUBLIC_OIDC_ENABLED === "true";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await signUp.email({ email, password, name });
    if (error) return setError(error.message ?? "Sign up failed");
    router.push("/app");
  }

  if (oidcEnabled) {
    return (
      <Card className="mx-auto mt-24 max-w-sm p-6">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-primary">◆ Quorum</span>
          <h1 className="text-xl font-semibold text-foreground">Sign-up is via SSO</h1>
          <p className="text-sm text-muted">
            This workspace uses single sign-on. Create your account by signing in
            with your identity provider.
          </p>
          <Link href="/login" className="text-sm text-muted hover:underline">
            Go to <span className="font-medium text-primary">Log in</span>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-24 max-w-sm p-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <span className="text-sm font-semibold text-primary">◆ Quorum</span>
        <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Name
          <Input
            aria-label="name"
            placeholder="Ada Lovelace"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Email
          <Input
            aria-label="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Password
          <Input
            aria-label="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-[var(--state-changes)]">
            {error}
          </p>
        )}
        <Button type="submit">Sign up</Button>
        <Link href="/login" className="text-sm text-muted hover:underline">
          Already have an account? <span className="font-medium text-primary">Log in</span>
        </Link>
      </form>
    </Card>
  );
}
