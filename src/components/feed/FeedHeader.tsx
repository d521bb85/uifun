export function FeedHeader() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex select-none items-center justify-between px-6 py-5 font-mono text-[13px] tracking-[0.04em] text-muted">
      <span>ui</span>
      <a
        href="https://ivanen.co"
        target="_blank"
        rel="noreferrer"
        className="pointer-events-auto text-muted no-underline transition-colors hover:text-foreground"
      >
        ivanen.co
      </a>
    </header>
  );
}
