"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";

export default function NewDocumentForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, markdown }),
      });
      if (res.status !== 201) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to create document");
        return;
      }
      const { id } = await res.json();
      router.push(`/app/documents/${id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">New document</h2>
      <Input
        aria-label="title"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Textarea
        aria-label="markdown"
        placeholder="# Markdown content"
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={8}
        className="font-mono"
      />
      {error && (
        <p role="alert" className="text-sm text-[var(--state-changes)]">
          {error}
        </p>
      )}
      <Button type="submit" disabled={submitting} className="self-start">
        Create document
      </Button>
    </form>
  );
}
