import { describe, expect, it } from "vitest";
import {
  computeKeyboardShiftY,
  isKeyboardInputElement,
  STAGE_EDGE_GAP_PX,
  STAGE_HEADER_GAP_PX,
  STAGE_TIGHT_EDGE_GAP_PX,
} from "./keyboardAvoidance";

describe("computeKeyboardShiftY", () => {
  it("returns 0 when no virtual keyboard is open or occlusion is minor (e.g. URL bar)", () => {
    expect(
      computeKeyboardShiftY({
        layoutHeight: 844,
        visualHeight: 844,
        visualOffsetTop: 0,
        visualScale: 1,
        contentNaturalTop: 314,
        contentHeight: 216,
        headerBottom: 58,
      }),
    ).toBe(0);

    // 56px browser address bar change should not trigger keyboard lifting
    expect(
      computeKeyboardShiftY({
        layoutHeight: 844,
        visualHeight: 788,
        visualOffsetTop: 0,
        visualScale: 1,
        contentNaturalTop: 314,
        contentHeight: 216,
        headerBottom: 58,
      }),
    ).toBe(0);
  });

  it("returns 0 when the user has pinch-zoomed the visual viewport", () => {
    expect(
      computeKeyboardShiftY({
        layoutHeight: 740,
        visualHeight: 370,
        visualOffsetTop: 0,
        visualScale: 2,
        contentNaturalTop: 262,
        contentHeight: 216,
        headerBottom: 58,
      }),
    ).toBe(0);
  });

  it("returns 0 on invalid or zero dimensions", () => {
    expect(
      computeKeyboardShiftY({
        layoutHeight: 0,
        visualHeight: 440,
        visualOffsetTop: 0,
        visualScale: 1,
        contentNaturalTop: 200,
        contentHeight: 216,
        headerBottom: 58,
      }),
    ).toBe(0);
    expect(
      computeKeyboardShiftY({
        layoutHeight: 740,
        visualHeight: Number.NaN,
        visualOffsetTop: 0,
        visualScale: 1,
        contentNaturalTop: 200,
        contentHeight: 216,
        headerBottom: 58,
      }),
    ).toBe(0);
  });

  it("centers the Astro Date Picker between header and keyboard on a typical mobile viewport", () => {
    // iPhone portrait: layout 740px, 300px keyboard -> visualHeight 440px, card 216px at y=262..478
    const shift = computeKeyboardShiftY({
      layoutHeight: 740,
      visualHeight: 440,
      visualOffsetTop: 0,
      visualScale: 1,
      contentNaturalTop: 262,
      contentHeight: 216,
      headerBottom: 58,
    });

    const newTop = 262 + shift;
    const newBottom = newTop + 216;
    expect(shift).toBe(-123);
    expect(newTop).toBeGreaterThanOrEqual(58 + STAGE_HEADER_GAP_PX);
    expect(newBottom).toBeLessThanOrEqual(440 - STAGE_EDGE_GAP_PX);
  });

  it("keeps the picker completely between header and keyboard on a compact phone (iPhone SE)", () => {
    // iPhone SE Safari: layout 553px, 260px keypad -> visualHeight 293px, card 206px at y=173.5..379.5
    const shift = computeKeyboardShiftY({
      layoutHeight: 553,
      visualHeight: 293,
      visualOffsetTop: 0,
      visualScale: 1,
      contentNaturalTop: 173.5,
      contentHeight: 206,
      headerBottom: 58,
    });

    const newTop = 173.5 + shift;
    const newBottom = newTop + 206;
    expect(shift).toBeLessThan(0);
    expect(newTop).toBeGreaterThanOrEqual(58 + STAGE_HEADER_GAP_PX);
    expect(newBottom).toBeLessThanOrEqual(293 - STAGE_EDGE_GAP_PX);
  });

  it("accounts for iOS Safari visualViewport.offsetTop when the browser pans the visual viewport", () => {
    // iOS panned visual viewport down by 80px: visible band in layout coords is [80, 520]
    const shift = computeKeyboardShiftY({
      layoutHeight: 740,
      visualHeight: 440,
      visualOffsetTop: 80,
      visualScale: 1,
      contentNaturalTop: 262,
      contentHeight: 216,
      headerBottom: 58,
    });

    const newTop = 262 + shift;
    const newBottom = newTop + 216;
    // Visually relative to visualViewport top (80):
    const visualTop = newTop - 80;
    const visualBottom = newBottom - 80;
    expect(shift).toBe(-70);
    expect(visualTop).toBe(112);
    expect(visualBottom).toBe(328);
    expect(440 - visualBottom).toBe(112); // centered symmetrically in visible area
  });

  it("shifts downward if extreme iOS visualViewport.offsetTop would otherwise clip the top", () => {
    // Visible band is [280, 720], natural card is [262, 478] (top clipped by 18px)
    const shift = computeKeyboardShiftY({
      layoutHeight: 740,
      visualHeight: 440,
      visualOffsetTop: 280,
      visualScale: 1,
      contentNaturalTop: 262,
      contentHeight: 216,
      headerBottom: 58,
    });

    const newTop = 262 + shift;
    const newBottom = newTop + 216;
    expect(shift).toBeGreaterThan(0);
    expect(newTop).toBeGreaterThanOrEqual(280 + STAGE_EDGE_GAP_PX);
    expect(newBottom).toBeLessThanOrEqual(720 - STAGE_EDGE_GAP_PX);
  });

  it("relaxes header clearance in tight portrait space so the entire picker stays above the keyboard", () => {
    // visualHeight 250px, header 58px -> available with header (164px) < card (206px),
    // but card still fits inside visualHeight - 2*12 (226px)
    const shift = computeKeyboardShiftY({
      layoutHeight: 600,
      visualHeight: 250,
      visualOffsetTop: 0,
      visualScale: 1,
      contentNaturalTop: 197,
      contentHeight: 206,
      headerBottom: 58,
    });

    const newTop = 197 + shift;
    const newBottom = newTop + 206;
    expect(newTop).toBeGreaterThanOrEqual(STAGE_TIGHT_EDGE_GAP_PX);
    expect(newBottom).toBe(250 - STAGE_TIGHT_EDGE_GAP_PX);
  });

  it("keeps bottom-aligned date segments visible above the keyboard in extreme landscape", () => {
    // Phone landscape: visualHeight 180px < card 216px; focused date input is near bottom [175..200]
    const shift = computeKeyboardShiftY({
      layoutHeight: 390,
      visualHeight: 180,
      visualOffsetTop: 0,
      visualScale: 1,
      contentNaturalTop: 87,
      contentHeight: 216,
      headerBottom: 58,
      focusedInContent: { top: 175, bottom: 200 },
    });

    const newTop = 87 + shift;
    const focusedTop = newTop + 175;
    const focusedBottom = newTop + 200;
    expect(focusedTop).toBeGreaterThanOrEqual(STAGE_TIGHT_EDGE_GAP_PX);
    expect(focusedBottom).toBeLessThanOrEqual(180 - STAGE_TIGHT_EDGE_GAP_PX);
    expect(newTop + 216).toBe(180 - STAGE_TIGHT_EDGE_GAP_PX);
  });

  it("keeps top-aligned focused inputs visible in extreme landscape instead of pushing them off-screen", () => {
    const shift = computeKeyboardShiftY({
      layoutHeight: 390,
      visualHeight: 180,
      visualOffsetTop: 0,
      visualScale: 1,
      contentNaturalTop: 65,
      contentHeight: 260,
      headerBottom: 58,
      focusedInContent: { top: 16, bottom: 48 },
    });

    const newTop = 65 + shift;
    const focusedTop = newTop + 16;
    const focusedBottom = newTop + 48;
    expect(focusedTop).toBe(STAGE_TIGHT_EDGE_GAP_PX);
    expect(focusedBottom).toBeLessThanOrEqual(180 - STAGE_TIGHT_EDGE_GAP_PX);
  });
});

describe("isKeyboardInputElement", () => {
  it("safely returns false in Node/SSR when element is null or HTMLElement is unavailable", () => {
    expect(isKeyboardInputElement(null)).toBe(false);
  });
});
