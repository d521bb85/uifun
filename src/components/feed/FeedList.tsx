import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExperimentStage } from "@/components/stage/ExperimentStage";
import type { ExperimentEntry } from "@/lib/registry";
import { FeedIndex } from "./FeedIndex";

export type FeedScrollToIndex = (index: number, options?: { push?: boolean }) => void;

export interface FeedListProps {
  items: readonly ExperimentEntry[];
  initialIndex: number;
  onActiveChange: (index: number, options: { push: boolean }) => void;
  scrollToRef?: RefObject<FeedScrollToIndex | null>;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
    return true;
  }
  const role = target.getAttribute("role");
  return role === "slider" || role === "spinbutton";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function FeedList({ items, initialIndex, onActiveChange, scrollToRef }: FeedListProps) {
  const scrollerRef = useRef<HTMLElement | null>(null);
  const totalScreens = items.length + 1;
  const sectionRefs = useRef<Map<number, HTMLElement>>(new Map());
  const currentIndexRef = useRef(initialIndex);
  const programmaticTargetRef = useRef<number | null>(null);
  const programmaticTimerRef = useRef<number | null>(null);

  const [mountedIndices, setMountedIndices] = useState<ReadonlySet<number>>(() =>
    initialIndex > 0 ? new Set([initialIndex]) : new Set(),
  );
  const [visibleIndices, setVisibleIndices] = useState<ReadonlySet<number>>(() =>
    initialIndex > 0 ? new Set([initialIndex]) : new Set(),
  );

  const clearProgrammaticLock = useCallback(() => {
    programmaticTargetRef.current = null;
    if (programmaticTimerRef.current !== null) {
      window.clearTimeout(programmaticTimerRef.current);
      programmaticTimerRef.current = null;
    }
  }, []);

  const scrollToIndex = useCallback<FeedScrollToIndex>(
    (rawIndex, options) => {
      const targetIndex = Math.max(0, Math.min(totalScreens - 1, rawIndex));
      const push = options?.push ?? true;

      if (targetIndex > 0) {
        items[targetIndex - 1]?.preload();
        setMountedIndices((prev) => {
          if (prev.has(targetIndex)) return prev;
          const next = new Set(prev);
          next.add(targetIndex);
          return next;
        });
      }

      currentIndexRef.current = targetIndex;
      onActiveChange(targetIndex, { push });

      const scroller = scrollerRef.current;
      const targetEl = sectionRefs.current.get(targetIndex);
      if (!scroller || !targetEl) return;

      const targetTop = targetEl.offsetTop;
      if (Math.abs(scroller.scrollTop - targetTop) <= 1) {
        clearProgrammaticLock();
        delete scroller.dataset.scrolling;
        return;
      }

      clearProgrammaticLock();
      programmaticTargetRef.current = targetIndex;
      scroller.dataset.scrolling = "";
      const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ top: targetTop, behavior });
      } else {
        scroller.scrollTop = targetTop;
      }
      programmaticTimerRef.current = window.setTimeout(() => {
        programmaticTargetRef.current = null;
        programmaticTimerRef.current = null;
        delete scroller.dataset.scrolling;
      }, 900);
    },
    [items, totalScreens, onActiveChange, clearProgrammaticLock],
  );

  useEffect(() => {
    if (scrollToRef) {
      scrollToRef.current = scrollToIndex;
    }
    return () => {
      if (scrollToRef) {
        scrollToRef.current = null;
      }
    };
  }, [scrollToRef, scrollToIndex]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || currentIndexRef.current <= 0) return;
    const targetEl = sectionRefs.current.get(currentIndexRef.current);
    if (targetEl) {
      scroller.scrollTop = targetEl.offsetTop;
    }
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof IntersectionObserver === "undefined") return;

    let scrollingTimer: number | null = null;
    let lastScrollTime = 0;
    let lastWidth = window.innerWidth;
    let resizeTimer: number | null = null;

    const clearScrollingFlag = () => {
      if (scrollingTimer !== null) {
        window.clearTimeout(scrollingTimer);
        scrollingTimer = null;
      }
      delete scroller.dataset.scrolling;
    };

    // Disable stage pointer/wheel listeners while the feed is moving so cards passing under the cursor cannot hijack the scroll.
    const onScroll = () => {
      lastScrollTime = Date.now();
      scroller.dataset.scrolling = "";
      if (scrollingTimer !== null) {
        window.clearTimeout(scrollingTimer);
      }
      scrollingTimer = window.setTimeout(() => {
        scrollingTimer = null;
        delete scroller.dataset.scrolling;
      }, 160);
    };

    const onScrollEnd = () => {
      clearScrollingFlag();
      if (programmaticTargetRef.current !== null) {
        clearProgrammaticLock();
      }
    };

    const onUserInput = () => {
      if (programmaticTargetRef.current !== null) {
        clearProgrammaticLock();
      }
    };

    // Skip vertical-only resizes on coarse pointers so iOS/Android address bar and virtual keyboard toggles don't jump scrollTop.
    const realignOnResize = () => {
      if (isCoarsePointer()) {
        if (Math.abs(window.innerWidth - lastWidth) <= 1) return;
        lastWidth = window.innerWidth;
      }
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (Date.now() - lastScrollTime < 160) {
        resizeTimer = window.setTimeout(realignOnResize, 160);
        return;
      }
      const targetEl = sectionRefs.current.get(currentIndexRef.current);
      if (targetEl) {
        scroller.scrollTop = targetEl.offsetTop;
      }
    };

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        const toMount: number[] = [];
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.index);
          if (!Number.isFinite(idx) || idx <= 0) continue;
          if (
            entry.isIntersecting &&
            (programmaticTargetRef.current === null || programmaticTargetRef.current === idx)
          ) {
            toMount.push(idx);
          }
        }

        setVisibleIndices((prev) => {
          let next: Set<number> | null = null;
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.index);
            if (!Number.isFinite(idx) || idx <= 0) continue;

            const has = prev.has(idx);
            if (entry.isIntersecting && !has) {
              next ??= new Set(prev);
              next.add(idx);
            } else if (!entry.isIntersecting && has) {
              next ??= new Set(prev);
              next.delete(idx);
            }
          }
          return next ?? prev;
        });

        if (toMount.length > 0) {
          setMountedIndices((prev) => {
            let next: Set<number> | null = null;
            for (const idx of toMount) {
              if (!prev.has(idx)) {
                next ??= new Set(prev);
                next.add(idx);
              }
            }
            return next ?? prev;
          });
        }
      },
      { root: scroller, rootMargin: "0px", threshold: 0.01 },
    );

    const activeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
          const idx = Number((entry.target as HTMLElement).dataset.index);
          if (!Number.isFinite(idx)) continue;

          if (programmaticTargetRef.current !== null) {
            if (idx === programmaticTargetRef.current) {
              clearProgrammaticLock();
            }
            continue;
          }

          if (idx > 0) {
            setMountedIndices((prev) => {
              if (prev.has(idx)) return prev;
              const next = new Set(prev);
              next.add(idx);
              return next;
            });
          }

          if (idx !== currentIndexRef.current) {
            currentIndexRef.current = idx;
            onActiveChange(idx, { push: false });
          }
        }
      },
      { root: scroller, threshold: [0.6] },
    );

    for (let i = 0; i < totalScreens; i++) {
      const node = sectionRefs.current.get(i);
      if (!node) continue;
      activeObserver.observe(node);
      if (i > 0) {
        visibilityObserver.observe(node);
      }
    }

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("scrollend", onScrollEnd, { passive: true });
    scroller.addEventListener("wheel", onUserInput, { passive: true });
    scroller.addEventListener("touchstart", onUserInput, { passive: true });
    window.addEventListener("resize", realignOnResize, { passive: true });

    return () => {
      clearScrollingFlag();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      clearProgrammaticLock();
      visibilityObserver.disconnect();
      activeObserver.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("scrollend", onScrollEnd);
      scroller.removeEventListener("wheel", onUserInput);
      scroller.removeEventListener("touchstart", onUserInput);
      window.removeEventListener("resize", realignOnResize);
    };
  }, [totalScreens, onActiveChange, clearProgrammaticLock]);

  useEffect(() => {
    if (totalScreens <= 1) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInteractiveTarget(event.target)) return;

      if (event.key === "j" || event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        const next = Math.min(currentIndexRef.current + 1, totalScreens - 1);
        if (next !== currentIndexRef.current) scrollToIndex(next, { push: true });
      } else if (event.key === "k" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        const prev = Math.max(currentIndexRef.current - 1, 0);
        if (prev !== currentIndexRef.current) scrollToIndex(prev, { push: true });
      } else if (event.key === "Home") {
        event.preventDefault();
        if (currentIndexRef.current !== 0) scrollToIndex(0, { push: true });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalScreens, scrollToIndex]);

  return (
    <main
      ref={scrollerRef}
      className="feed-scroll relative z-10 flex h-full w-full snap-y snap-mandatory flex-col overflow-y-auto overscroll-contain [overflow-anchor:none]"
    >
      <FeedIndex
        items={items}
        onSelect={(index) => scrollToIndex(index, { push: true })}
        sectionRef={(node) => {
          if (node) {
            sectionRefs.current.set(0, node);
          } else {
            sectionRefs.current.delete(0);
          }
        }}
      />
      {items.map((experiment, i) => {
        const index = i + 1;
        return (
          <ExperimentStage
            key={experiment.slug}
            experiment={experiment}
            mounted={mountedIndices.has(index)}
            active={visibleIndices.has(index)}
            stageRef={(node) => {
              if (node) {
                node.dataset.index = String(index);
                sectionRefs.current.set(index, node);
              } else {
                sectionRefs.current.delete(index);
              }
            }}
          />
        );
      })}
    </main>
  );
}
