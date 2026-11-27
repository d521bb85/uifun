import type { MouseEvent } from "react";
import type { ExperimentEntry } from "@/lib/registry";
import { EmptyFeed } from "./EmptyFeed";

export interface FeedIndexProps {
  items: readonly ExperimentEntry[];
  onSelect: (index: number) => void;
  sectionRef?: (node: HTMLElement | null) => void;
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0;
}

export function FeedIndex({ items, onSelect, sectionRef }: FeedIndexProps) {
  if (items.length === 0) {
    return (
      <section
        ref={sectionRef}
        data-index="0"
        className="flex h-full w-full shrink-0 snap-start snap-always flex-col items-center justify-center px-6"
      >
        <EmptyFeed />
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      data-index="0"
      data-screen="index"
      className="flex h-full w-full shrink-0 snap-start snap-always flex-col items-center justify-center px-6"
    >
      <nav aria-label="Experiments" className="w-full max-w-[260px] -translate-y-[6vh] text-left">
        <ul className="flex flex-col gap-2">
          {items.map((experiment, index) => (
            <li key={experiment.slug}>
              <a
                href={`/e/${experiment.slug}`}
                onPointerEnter={() => experiment.preload()}
                onFocus={() => experiment.preload()}
                onClick={(event) => {
                  if (!isPlainLeftClick(event)) return;
                  event.preventDefault();
                  onSelect(index + 1);
                }}
                className="inline-block py-0.5 font-mono text-[13px] tracking-[0.04em] text-foreground/80 no-underline transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fg"
              >
                {experiment.slug}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
