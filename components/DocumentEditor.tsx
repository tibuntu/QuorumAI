"use client";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/Button";

export default function DocumentEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <div data-testid="editor" className="overflow-hidden rounded-[var(--radius-app)] border border-border">
          <CodeMirror
            value={value}
            height="60vh"
            extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
            onChange={onChange}
            aria-label="editor"
          />
        </div>
        <div className="prose prose-violet max-w-none overflow-auto rounded-[var(--radius-app)] border border-border bg-surface p-3" style={{ maxHeight: "60vh" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-[var(--state-changes)]">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
          Save
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
