import { useEffect, useRef, useState } from "react";
import { ExperimentStage } from "@/components/stage/ExperimentStage";
import type { ExperimentEntry } from "@/lib/registry";
import { EmptyFeed } from "./EmptyFeed";

export interface FeedListProps {
  items: readonly ExperimentEntry[];
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function FeedList({ items }: FeedListProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (items.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      if (event.key !== "j" && event.key !== "k") return;

      event.preventDefault();
      setFocusedIndex((prev) => {
        const next =
          event.key === "j"
            ? prev === null
              ? 0
              : Math.min(prev + 1, items.length - 1)
            : prev === null
              ? items.length - 1
              : Math.max(prev - 1, 0);

        const targetItem = items[next];
        if (targetItem) {
          cardRefs.current.get(targetItem.slug)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
        return next;
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items]);

  if (items.length === 0) {
    return <EmptyFeed />;
  }

  return (
    <div className="flex flex-col gap-8">
      {items.map((experiment, index) => (
        <ExperimentStage
          key={experiment.slug}
          experiment={experiment}
          focused={focusedIndex === index}
          stageRef={(node) => {
            if (node) {
              cardRefs.current.set(experiment.slug, node);
            } else {
              cardRefs.current.delete(experiment.slug);
            }
          }}
        />
      ))}
    </div>
  );
}
