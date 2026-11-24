import { useEffect, useRef } from "react";
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
  const activeIndexRef = useRef<number | null>(null);
  const stageRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (items.length <= 1) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      if (event.key !== "j" && event.key !== "k") return;

      event.preventDefault();
      const prev = activeIndexRef.current;
      const next =
        event.key === "j"
          ? prev === null
            ? 0
            : Math.min(prev + 1, items.length - 1)
          : prev === null
            ? items.length - 1
            : Math.max(prev - 1, 0);

      activeIndexRef.current = next;
      const targetItem = items[next];
      if (targetItem) {
        stageRefs.current.get(targetItem.slug)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items]);

  if (items.length === 0) {
    return <EmptyFeed />;
  }

  return (
    <div className="w-full">
      {items.map((experiment) => (
        <ExperimentStage
          key={experiment.slug}
          experiment={experiment}
          stageRef={(node) => {
            if (node) {
              stageRefs.current.set(experiment.slug, node);
            } else {
              stageRefs.current.delete(experiment.slug);
            }
          }}
        />
      ))}
    </div>
  );
}
