"use client";

import {
  createHoverCardController,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@ui-sdk/react/hover-card";
import { type MouseEvent, useState } from "react";
import { cn } from "@/lib/cn";
import type { ExperimentEntry } from "@/lib/registry";

export interface FeedNavProps {
  items: readonly ExperimentEntry[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

interface NavEntry {
  key: string;
  index: number;
  href: string;
  label: string;
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0;
}

export function FeedNav({ items, activeIndex, onSelect }: FeedNavProps) {
  const [card] = useState(() => createHoverCardController<NavEntry>());

  const entries: NavEntry[] = [
    { key: "__index__", index: 0, href: "/", label: "ui" },
    ...items.map((experiment, i) => ({
      key: experiment.slug,
      index: i + 1,
      href: `/e/${experiment.slug}`,
      label: experiment.slug,
    })),
  ];

  const handleLinkClick = (entry: NavEntry, event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    onSelect(entry.index);
    card.close({ event: event.nativeEvent });
  };

  return (
    <nav
      aria-label="Screen navigation"
      className="fixed top-1/2 right-[max(0.75rem,env(safe-area-inset-right))] z-20 flex -translate-y-1/2 flex-col items-center gap-0.5 select-none sm:right-[max(1.25rem,env(safe-area-inset-right))]"
    >
      {entries.map((entry) => {
        const isActive = entry.index === activeIndex;
        return (
          <HoverCardTrigger
            key={entry.key}
            controller={card}
            payload={entry}
            href={entry.href}
            aria-label={entry.label}
            aria-current={isActive ? "page" : undefined}
            onPointerEnter={() => {
              if (entry.index > 0) items[entry.index - 1]?.preload();
            }}
            onFocus={() => {
              if (entry.index > 0) items[entry.index - 1]?.preload();
            }}
            onClick={(event) => handleLinkClick(entry, event)}
            className="group flex size-5 items-center justify-center rounded-full no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg sm:size-3.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                "block size-[7px] rounded-full border transition-colors duration-150",
                isActive
                  ? "border-foreground bg-foreground"
                  : "border-muted/70 bg-transparent group-hover:border-foreground group-data-open:border-foreground",
              )}
            />
          </HoverCardTrigger>
        );
      })}
      <HoverCard controller={card} delay={120} closeDelay={180}>
        <HoverCardContent<NavEntry>
          side="left"
          align="center"
          sideOffset={8}
          className="w-auto min-w-0 max-w-none origin-(--transform-origin) border-0 bg-transparent px-1 py-0.5 font-mono text-[11px] leading-tight tracking-[0.03em] text-muted shadow-none transition-[opacity,scale] duration-150 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none"
        >
          {(state) =>
            state.payload ? (
              <a
                href={state.payload.href}
                onClick={(event) => {
                  if (state.payload) handleLinkClick(state.payload, event);
                }}
                className="whitespace-nowrap text-muted no-underline transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
              >
                {state.payload.label}
              </a>
            ) : null
          }
        </HoverCardContent>
      </HoverCard>
    </nav>
  );
}
