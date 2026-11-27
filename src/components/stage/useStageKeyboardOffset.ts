import { type RefObject, useEffect, useState } from "react";
import { computeKeyboardShiftY, isKeyboardInputElement } from "./keyboardAvoidance";

/**
 * Tracks mobile virtual keyboard occlusion via window.visualViewport and returns
 * a vertical pixel translation that keeps the active stage's content centered
 * above the keyboard without resizing the scroll-snap stage.
 */
export function useStageKeyboardOffset(
  sectionRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  active: boolean,
  mounted: boolean,
): number {
  const [offsetY, setOffsetY] = useState(0);

  useEffect(() => {
    if (!mounted) {
      setOffsetY(0);
      return;
    }

    const section = sectionRef.current;
    const content = contentRef.current;

    if (!active) {
      setOffsetY(0);
      // If the user scrolled away from this stage while an input inside it was focused,
      // blur it so an off-screen experiment does not hold the virtual keyboard open.
      if (
        content &&
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement &&
        content.contains(document.activeElement) &&
        isKeyboardInputElement(document.activeElement)
      ) {
        document.activeElement.blur();
      }
      return;
    }

    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!section || !content || !vv) {
      setOffsetY(0);
      return;
    }

    let keyboardFocused =
      typeof document !== "undefined" &&
      document.activeElement !== null &&
      content.contains(document.activeElement) &&
      isKeyboardInputElement(document.activeElement);
    let rafId: number | null = null;
    let blurCheckRafId: number | null = null;
    let listenersAttached = false;
    let resizeObserver: ResizeObserver | null = null;

    const measure = () => {
      if (!keyboardFocused) {
        setOffsetY(0);
        return;
      }

      const layoutHeight = section.clientHeight || window.innerHeight;
      const parent = section.parentElement;
      const sectionTopInLayout = parent ? section.offsetTop - parent.scrollTop : 0;
      const contentNaturalTop = sectionTopInLayout + content.offsetTop;
      const contentHeight = content.offsetHeight;

      const header = document.querySelector<HTMLElement>("[data-feed-header]");
      const headerBottom = header ? header.offsetHeight : 0;

      let focusedInContent: { top: number; bottom: number } | null = null;
      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLElement && content.contains(activeEl)) {
        const contentRect = content.getBoundingClientRect();
        const focusedRect = activeEl.getBoundingClientRect();
        focusedInContent = {
          top: focusedRect.top - contentRect.top,
          bottom: focusedRect.bottom - contentRect.top,
        };
      }

      const nextOffset = computeKeyboardShiftY({
        layoutHeight,
        visualHeight: vv.height,
        visualOffsetTop: vv.offsetTop,
        visualScale: vv.scale,
        contentNaturalTop,
        contentHeight,
        headerBottom,
        focusedInContent,
      });

      setOffsetY((prev) => (prev === nextOffset ? prev : nextOffset));
    };

    const scheduleMeasure = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };

    const attachViewportListeners = () => {
      if (listenersAttached) return;
      listenersAttached = true;
      vv.addEventListener("resize", scheduleMeasure);
      vv.addEventListener("scroll", scheduleMeasure);
      window.addEventListener("resize", scheduleMeasure, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleMeasure);
        resizeObserver.observe(content);
      }
    };

    const detachViewportListeners = () => {
      if (!listenersAttached) return;
      listenersAttached = false;
      vv.removeEventListener("resize", scheduleMeasure);
      vv.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (blurCheckRafId !== null) {
        window.cancelAnimationFrame(blurCheckRafId);
        blurCheckRafId = null;
      }
      if (!isKeyboardInputElement(event.target as Element | null)) return;
      keyboardFocused = true;
      attachViewportListeners();
      scheduleMeasure();
    };

    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget as Element | null;
      if (nextTarget && content.contains(nextTarget) && isKeyboardInputElement(nextTarget)) {
        if (blurCheckRafId !== null) {
          window.cancelAnimationFrame(blurCheckRafId);
          blurCheckRafId = null;
        }
        scheduleMeasure();
        return;
      }

      if (blurCheckRafId !== null) {
        window.cancelAnimationFrame(blurCheckRafId);
      }
      blurCheckRafId = window.requestAnimationFrame(() => {
        blurCheckRafId = null;
        const activeEl = document.activeElement;
        if (activeEl && content.contains(activeEl) && isKeyboardInputElement(activeEl)) {
          keyboardFocused = true;
          attachViewportListeners();
          scheduleMeasure();
          return;
        }
        keyboardFocused = false;
        detachViewportListeners();
        setOffsetY(0);
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      });
    };

    content.addEventListener("focusin", handleFocusIn);
    content.addEventListener("focusout", handleFocusOut);

    if (keyboardFocused) {
      attachViewportListeners();
      scheduleMeasure();
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (blurCheckRafId !== null) window.cancelAnimationFrame(blurCheckRafId);
      content.removeEventListener("focusin", handleFocusIn);
      content.removeEventListener("focusout", handleFocusOut);
      detachViewportListeners();
    };
  }, [sectionRef, contentRef, active, mounted]);

  return offsetY;
}
