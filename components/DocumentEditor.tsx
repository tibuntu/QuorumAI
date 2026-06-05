"use client";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
        <div data-testid="editor" className="rounded border">
          <CodeMirror
            value={value}
            height="60vh"
            extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
            onChange={onChange}
            aria-label="editor"
          />
        </div>
        <div className="prose max-w-none overflow-auto rounded border p-3" style={{ maxHeight: "60vh" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded border px-3 py-1 text-sm">Cancel</button>
      </div>
    </div>
  );
}
