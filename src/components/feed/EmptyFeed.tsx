import { Sparkles } from "lucide-react";

const EXAMPLE_SNIPPET = `// src/experiments/magnetic-toggle/index.tsx
import { defineExperiment } from "@/lib/define-experiment";

export default defineExperiment({
  title: "Magnetic Toggle",
  date: "2026-11-24",
  tags: ["switch", "spring"],
  component: () => <button>...</button>,
});`;

export function EmptyFeed() {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-dashed border-border bg-surface">
      <div className="stage-grid flex min-h-[360px] flex-col items-center justify-center gap-6 p-8 text-center sm:p-12">
        <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-foreground shadow-xs">
          <Sparkles className="size-5" />
        </div>

        <div className="max-w-md space-y-1.5">
          <h1 className="text-base font-medium tracking-tight text-foreground">
            No experiments yet
          </h1>
          <p className="text-sm leading-relaxed text-muted">
            Drop a folder in{" "}
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-xs text-foreground">
              src/experiments/&lt;slug&gt;/index.tsx
            </code>{" "}
            to appear in the feed automatically.
          </p>
        </div>

        <pre className="w-full max-w-lg overflow-x-auto rounded-xl border border-border bg-surface p-4 text-left font-mono text-xs leading-relaxed text-muted">
          <code>{EXAMPLE_SNIPPET}</code>
        </pre>
      </div>
    </section>
  );
}
