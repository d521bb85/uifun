import type { MouseEvent } from "react";

export interface FeedHeaderProps {
  alias?: string;
  onHomeClick?: () => void;
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0;
}

export function FeedHeader({ alias, onHomeClick }: FeedHeaderProps) {
  return (
    <header
      data-feed-header=""
      className="pointer-events-none fixed inset-x-0 top-0 z-20 flex select-none items-center justify-between gap-4 pt-[max(1.25rem,env(safe-area-inset-top))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-5 pl-[max(1.5rem,env(safe-area-inset-left))] font-mono text-[13px] tracking-[0.04em] text-muted"
    >
      <span className="flex min-w-0 items-center gap-5">
        <a
          href="/"
          aria-label="ui — home"
          onClick={(event) => {
            if (!onHomeClick || !isPlainLeftClick(event)) return;
            event.preventDefault();
            onHomeClick();
          }}
          className="pointer-events-auto shrink-0 text-muted no-underline transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fg"
        >
          ui
        </a>
        {alias && <span className="truncate">{alias}</span>}
      </span>
      <a
        href="https://ivanen.co"
        target="_blank"
        rel="noreferrer"
        className="pointer-events-auto shrink-0 text-muted no-underline transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fg"
      >
        ivanen.co
      </a>
    </header>
  );
}
