export interface FeedHeaderProps {
  alias?: string;
}

export function FeedHeader({ alias }: FeedHeaderProps) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-20 grid select-none grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-5 font-mono text-[13px] tracking-[0.04em] text-muted">
      <span className="justify-self-start">ui</span>
      {alias ? (
        <span className="max-w-[50vw] justify-self-center truncate">{alias}</span>
      ) : (
        <span aria-hidden="true" />
      )}
      <a
        href="https://ivanen.co"
        target="_blank"
        rel="noreferrer"
        className="pointer-events-auto justify-self-end text-muted no-underline hover:text-foreground"
      >
        ivanen.co
      </a>
    </header>
  );
}
