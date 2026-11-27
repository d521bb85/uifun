export const KEYBOARD_MIN_OCCLUSION_PX = 100;
export const MAX_UNZOOMED_SCALE = 1.05;
export const STAGE_EDGE_GAP_PX = 16;
export const STAGE_TIGHT_EDGE_GAP_PX = 12;
export const STAGE_HEADER_GAP_PX = 12;

export interface KeyboardAvoidanceMetrics {
  /** Height of the stage / layout viewport in CSS px. */
  layoutHeight: number;
  /** Visible height reported by window.visualViewport.height in CSS px. */
  visualHeight: number;
  /** Offset of the visual viewport relative to the layout viewport top in CSS px. */
  visualOffsetTop: number;
  /** Pinch-zoom scale factor (window.visualViewport.scale). */
  visualScale: number;
  /** Unshifted top of [data-stage-content] in layout viewport coordinates (CSS px). */
  contentNaturalTop: number;
  /** Height of [data-stage-content] in CSS px. */
  contentHeight: number;
  /** Bottom edge of the fixed top header in layout viewport coordinates (CSS px, 0 if none). */
  headerBottom: number;
  /** Optional focused element vertical bounds relative to [data-stage-content] top (CSS px). */
  focusedInContent?: { top: number; bottom: number } | null;
}

const NON_KEYBOARD_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Returns true if focusing this element can open a software virtual keyboard on mobile devices.
 */
export function isKeyboardInputElement(element: Element | null): boolean {
  if (!element || typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) {
    return false;
  }
  if (element.getAttribute("inputmode")?.toLowerCase() === "none") {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLInputElement) {
    if (element.disabled || element.readOnly) return false;
    const type = (element.type || "text").toLowerCase();
    return !NON_KEYBOARD_INPUT_TYPES.has(type);
  }
  return false;
}

/**
 * Computes the vertical translation (in CSS px) needed to keep an active stage's content
 * clearly visible above an open mobile virtual keyboard without resizing the scroll-snap stage.
 */
export function computeKeyboardShiftY(metrics: KeyboardAvoidanceMetrics): number {
  const {
    layoutHeight,
    visualHeight,
    visualOffsetTop,
    visualScale,
    contentNaturalTop,
    contentHeight,
    headerBottom,
    focusedInContent,
  } = metrics;

  if (
    !Number.isFinite(layoutHeight) ||
    !Number.isFinite(visualHeight) ||
    !Number.isFinite(visualOffsetTop) ||
    !Number.isFinite(visualScale) ||
    !Number.isFinite(contentNaturalTop) ||
    !Number.isFinite(contentHeight) ||
    layoutHeight <= 0 ||
    visualHeight <= 0 ||
    contentHeight <= 0
  ) {
    return 0;
  }

  // Do not fight user pinch-zoom panning.
  if (visualScale > MAX_UNZOOMED_SCALE) {
    return 0;
  }

  // Only engage when the visual viewport is meaningfully occluded by a virtual keyboard
  // (ignoring minor mobile browser URL-bar height differences and layout-resizing browsers).
  const occludedHeight = layoutHeight - visualHeight;
  if (occludedHeight < KEYBOARD_MIN_OCCLUSION_PX) {
    return 0;
  }

  const visibleTop = visualOffsetTop;
  const visibleBottom = visualOffsetTop + visualHeight;
  const headerClearance = headerBottom > 0 ? headerBottom + STAGE_HEADER_GAP_PX : 0;
  const safeTop = Math.max(visibleTop + STAGE_EDGE_GAP_PX, headerClearance);
  const safeBottom = visibleBottom - STAGE_EDGE_GAP_PX;
  const availableWithHeader = safeBottom - safeTop;

  let targetTop: number;

  if (contentHeight <= availableWithHeader) {
    // Regime 1: Content fits comfortably between the header and the virtual keyboard.
    // Center it in that visible band for balanced breathing room above the keys.
    targetTop = safeTop + (availableWithHeader - contentHeight) / 2;
  } else if (contentHeight <= visualHeight - 2 * STAGE_TIGHT_EDGE_GAP_PX) {
    // Regime 2: Tight vertical space (e.g. small screen with tall keyboard toolbar).
    // Relax header clearance so the entire control stays completely above the keyboard.
    targetTop = visibleBottom - STAGE_TIGHT_EDGE_GAP_PX - contentHeight;
  } else {
    // Regime 3: Extreme tight space (e.g. phone in landscape) where content exceeds visualHeight.
    // Keep the bottom of the control above the keyboard while guaranteeing the focused input stays in view.
    const desiredTop = visibleBottom - STAGE_TIGHT_EDGE_GAP_PX - contentHeight;
    if (
      focusedInContent &&
      Number.isFinite(focusedInContent.top) &&
      Number.isFinite(focusedInContent.bottom)
    ) {
      const minTop = visibleTop + STAGE_TIGHT_EDGE_GAP_PX - focusedInContent.top;
      const maxTop = visibleBottom - STAGE_TIGHT_EDGE_GAP_PX - focusedInContent.bottom;
      targetTop = minTop <= maxTop ? Math.min(maxTop, Math.max(minTop, desiredTop)) : minTop;
    } else {
      targetTop = visibleTop + STAGE_TIGHT_EDGE_GAP_PX;
    }
  }

  const shift = Math.round(targetTop - contentNaturalTop);
  return Math.abs(shift) < 1 ? 0 : shift;
}
