"use client";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/Button";
import { useResolvedDark } from "@/lib/use-resolved-dark";

// Token-driven dark theme for the CodeMirror pane. Colours come from the
// "Violet consensus" design tokens (resolved live from :root.dark in globals.css)
// so the editor matches the rest of the app in dark mode. Kept compact: surface,
// text, selection, gutter and cursor — no bespoke syntax palette.
const darkEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--surface)",
      color: "var(--foreground)",
    },
    ".cm-content": { caretColor: "var(--primary)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "var(--primary-subtle)" },
    ".cm-gutters": {
      backgroundColor: "var(--background)",
      color: "var(--muted)",
      border: "none",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLine": { backgroundColor: "var(--state-neutral-bg)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--state-neutral-bg)" },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--primary-subtle)",
      color: "var(--foreground)",
      border: "none",
    },
  },
  { dark: true },
);

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
  const isDark = useResolvedDark();
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div data-testid="editor" className="overflow-hidden rounded-[var(--radius-app)] border border-border">
          <CodeMirror
            value={value}
            height="60vh"
            extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
            theme={isDark ? darkEditorTheme : undefined}
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
