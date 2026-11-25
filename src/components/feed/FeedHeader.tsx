export interface FeedHeaderProps {
  alias?: string;
}

export function FeedHeader({ alias }: FeedHeaderProps) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex select-none items-center justify-between gap-4 px-6 py-5 font-mono text-[13px] tracking-[0.04em] text-muted">
      <span className="flex min-w-0 items-center gap-5">
        <span className="shrink-0">ui</span>
        {alias && <span className="truncate">{alias}</span>}
      </span>
      <a
        href="https://ivanen.co"
        target="_blank"
        rel="noreferrer"
        className="pointer-events-auto shrink-0 text-muted no-underline hover:text-foreground"
      >
        ivanen.co
      </a>
    </header>
  );
}
