import { describe, expect, it } from "vitest";
import {
  classifyDragIntent,
  computeDragStepTransition,
  computeSnappedSteps,
  DAYS_PER_CARD_WIDTH,
  DEFAULT_CARD_WIDTH_PX,
  getStepPxForUnit,
  isEditableUnit,
  MONTHS_PER_CARD_WIDTH,
  resolveTouchEndBehavior,
  STEP_PX_BY_UNIT,
} from "./dragMath";

describe("dragMath", () => {
  it("identifies editable date units cleanly", () => {
    expect(isEditableUnit("year")).toBe(true);
    expect(isEditableUnit("month")).toBe(true);
    expect(isEditableUnit("day")).toBe(true);
    expect(isEditableUnit("literal")).toBe(false);
    expect(isEditableUnit("hour")).toBe(false);
    expect(isEditableUnit(null)).toBe(false);
    expect(isEditableUnit(undefined)).toBe(false);
  });

  it("computes responsive step sizes with safe fallback widths", () => {
    expect(getStepPxForUnit("year", 300)).toBe(STEP_PX_BY_UNIT.year);
    expect(getStepPxForUnit("month", 480)).toBeCloseTo(480 / MONTHS_PER_CARD_WIDTH, 6);
    expect(getStepPxForUnit("day", 300)).toBeCloseTo(300 / DAYS_PER_CARD_WIDTH, 6);
    expect(getStepPxForUnit("month", 0)).toBeCloseTo(
      DEFAULT_CARD_WIDTH_PX / MONTHS_PER_CARD_WIDTH,
      6,
    );
    expect(getStepPxForUnit("day", Number.NaN)).toBeCloseTo(
      DEFAULT_CARD_WIDTH_PX / DAYS_PER_CARD_WIDTH,
      6,
    );
  });

  it("snaps steps symmetrically with hysteresis and guards invalid thresholds", () => {
    expect(computeSnappedSteps(0.9, 0, 1)).toBe(0);
    expect(computeSnappedSteps(1.0, 0, 1)).toBe(1);
    expect(computeSnappedSteps(-1.0, 0, 1)).toBe(-1);
    expect(computeSnappedSteps(3.4, 0, 1)).toBe(3);
    expect(computeSnappedSteps(-2.7, 1, 1)).toBe(-2);
    expect(computeSnappedSteps(Number.NaN, 2, 1)).toBe(2);
    expect(computeSnappedSteps(5, 2, 0)).toBe(2);
  });

  it("steps through adjacent months sequentially and preserves 31st-of-month anchor day", () => {
    const step1 = computeDragStepTransition({
      baseIso: "2026-01-31",
      currentIso: "2026-01-31",
      unit: "month",
      appliedSteps: 0,
      rawSteps: 1.25,
      min: "0001-01-01",
      max: "9999-12-31",
    });
    expect(step1.nextSteps).toBe(1);
    expect(step1.nextIso).toBe("2026-02-28");
    expect(step1.stepIsos).toEqual(["2026-02-28"]);
    expect(step1.fraction).toBeCloseTo(0.25, 6);
    expect(step1.clampedAtBoundary).toBe(false);

    const step2 = computeDragStepTransition({
      baseIso: "2026-01-31",
      currentIso: "2026-02-28",
      unit: "month",
      appliedSteps: 1,
      rawSteps: 2.4,
      min: "0001-01-01",
      max: "9999-12-31",
    });
    expect(step2.nextSteps).toBe(2);
    expect(step2.nextIso).toBe("2026-03-31");
    expect(step2.stepIsos).toEqual(["2026-03-31"]);
    expect(step2.fraction).toBeCloseTo(0.4, 6);
  });

  it("emits every intermediate ISO when fast dragging jumps multiple days", () => {
    const jump = computeDragStepTransition({
      baseIso: "2024-02-27",
      currentIso: "2024-02-27",
      unit: "day",
      appliedSteps: 0,
      rawSteps: 3.1,
      min: "0001-01-01",
      max: "9999-12-31",
    });
    expect(jump.nextSteps).toBe(3);
    expect(jump.nextIso).toBe("2024-02-01");
    expect(jump.stepIsos).toEqual(["2024-02-28", "2024-02-29", "2024-02-01"]);
    expect(jump.fraction).toBeCloseTo(0.1, 6);
  });

  it("clamps cleanly at min/max boundaries without step wind-up or visual drift past bounds", () => {
    const hitMaxYear = computeDragStepTransition({
      baseIso: "2025-06-15",
      currentIso: "2026-06-15",
      unit: "year",
      appliedSteps: 1,
      rawSteps: 5,
      min: "2020-01-01",
      max: "2026-06-15",
    });
    expect(hitMaxYear.clampedAtBoundary).toBe(true);
    expect(hitMaxYear.nextSteps).toBe(1);
    expect(hitMaxYear.nextIso).toBe("2026-06-15");
    expect(hitMaxYear.stepIsos).toEqual([]);

    // Peeking past max month zeroes visual fraction so Earth doesn't drift into forbidden month
    const peekMaxMonth = computeDragStepTransition({
      baseIso: "2026-09-15",
      currentIso: "2026-09-15",
      unit: "month",
      appliedSteps: 0,
      rawSteps: 0.6,
      min: "2026-01-01",
      max: "2026-09-15",
    });
    expect(peekMaxMonth.clampedAtBoundary).toBe(true);
    expect(peekMaxMonth.fraction).toBe(0);
  });

  it("distinguishes horizontal touch scrubbing from vertical page scrolling", () => {
    // Mouse engages at 5px horizontally
    expect(classifyDragIntent(4, 0, "mouse")).toBe("pending");
    expect(classifyDragIntent(5, 20, "mouse")).toBe("drag");

    // Touch absorbs small finger-pad jitter (< 8px)
    expect(classifyDragIntent(6, 2, "touch")).toBe("pending");
    // Touch yields to vertical page scroll when vertical motion dominates
    expect(classifyDragIntent(4, 9, "touch")).toBe("cancel");
    expect(classifyDragIntent(10, 14, "touch")).toBe("cancel");
    // Touch engages horizontal scrubbing when horizontal motion reaches threshold and dominates
    expect(classifyDragIntent(8, 3, "touch")).toBe("drag");
    expect(classifyDragIntent(-12, 8, "touch")).toBe("drag");
  });

  it("keeps the mobile keyboard open across touch taps and drags without blocking initial tap focus", () => {
    // Unfocused tap on card chrome or label must not cancel click so iOS/Android open the keyboard
    expect(
      resolveTouchEndBehavior({
        startedOnCardChrome: true,
        wasFocusedAtStart: false,
        didDrag: false,
        targetUnit: "month",
      }),
    ).toEqual({ preventDefault: false, refocusUnit: null });

    // Unfocused tap directly on a segment lets native input focus open the keyboard
    expect(
      resolveTouchEndBehavior({
        startedOnCardChrome: false,
        wasFocusedAtStart: false,
        didDrag: false,
        targetUnit: "day",
      }),
    ).toEqual({ preventDefault: false, refocusUnit: null });

    // Touch drag on card body or starting on a segment suppresses post-drag blur/click
    expect(
      resolveTouchEndBehavior({
        startedOnCardChrome: true,
        wasFocusedAtStart: true,
        didDrag: true,
        targetUnit: "month",
      }),
    ).toEqual({ preventDefault: true, refocusUnit: null });
    expect(
      resolveTouchEndBehavior({
        startedOnCardChrome: false,
        wasFocusedAtStart: true,
        didDrag: true,
        targetUnit: "day",
      }),
    ).toEqual({ preventDefault: true, refocusUnit: null });

    // Tapping card body or label while already focused prevents blur and keeps active segment focused
    expect(
      resolveTouchEndBehavior({
        startedOnCardChrome: true,
        wasFocusedAtStart: true,
        didDrag: false,
        targetUnit: "year",
      }),
    ).toEqual({ preventDefault: true, refocusUnit: "year" });

    // Tapping another date segment while focused lets native focus transfer without dismissing keyboard
    expect(
      resolveTouchEndBehavior({
        startedOnCardChrome: false,
        wasFocusedAtStart: true,
        didDrag: false,
        targetUnit: "day",
      }),
    ).toEqual({ preventDefault: false, refocusUnit: null });
  });
});
