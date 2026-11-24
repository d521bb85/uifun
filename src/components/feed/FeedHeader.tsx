import { Link } from "@tanstack/react-router";
import { Button } from "@ui-sdk/react/button";
import { cn } from "@/lib/cn";

export interface FeedHeaderProps {
  totalCount: number;
  tags: readonly string[];
  activeTag?: string;
  onSelectTag: (tag?: string) => void;
}

export function FeedHeader({ totalCount, tags, activeTag, onSelectTag }: FeedHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/"
            search={{}}
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-foreground"
          >
            <span className="inline-block size-2 rounded-full bg-foreground" aria-hidden="true" />
            <span>uifun</span>
            <span className="rounded-md bg-surface-subtle px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted">
              {totalCount}
            </span>
          </Link>

          <div className="flex items-center gap-3 font-mono text-[11px] text-muted">
            {totalCount > 1 ? (
              <span className="hidden items-center gap-1 sm:inline-flex">
                <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]">
                  j
                </kbd>
                <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]">
                  k
                </kbd>
                <span className="ml-0.5">navigate</span>
              </span>
            ) : null}
            <a
              href="https://ivanen.co"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              ivanen.co
            </a>
          </div>
        </div>

        {tags.length > 0 ? (
          <nav
            aria-label="Filter experiments by tag"
            className="flex flex-wrap items-center gap-1.5"
          >
            <Button
              onClick={() => onSelectTag(undefined)}
              data-active={activeTag === undefined ? "" : undefined}
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                activeTag === undefined
                  ? "border-foreground bg-foreground text-canvas"
                  : "border-border bg-surface text-muted hover:text-foreground",
              )}
            >
              all
            </Button>
            {tags.map((tag) => {
              const selected = activeTag === tag;
              return (
                <Button
                  key={tag}
                  onClick={() => onSelectTag(selected ? undefined : tag)}
                  data-active={selected ? "" : undefined}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                    selected
                      ? "border-foreground bg-foreground text-canvas"
                      : "border-border bg-surface text-muted hover:text-foreground",
                  )}
                >
                  #{tag}
                </Button>
              );
            })}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
