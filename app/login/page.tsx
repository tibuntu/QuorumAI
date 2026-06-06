"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await signIn.email({ email, password });
    if (error) return setError(error.message ?? "Login failed");
    router.push("/app");
  }

  return (
    <Card className="mx-auto mt-24 max-w-sm p-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <span className="text-sm font-semibold text-primary">◆ Quorum</span>
        <h1 className="text-xl font-semibold text-foreground">Log in</h1>
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
        <Button type="submit">Log in</Button>
        <Link href="/register" className="text-sm text-muted hover:underline">
          Need an account? <span className="font-medium text-primary">Sign up</span>
        </Link>
      </form>
    </Card>
  );
}
