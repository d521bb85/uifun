import { addDateSegment, parseIsoDate } from "./astronomy";

export type EditableDateUnit = "year" | "month" | "day";

export const DRAG_THRESHOLD_PX = 5;
export const TOUCH_DRAG_THRESHOLD_PX = 8;
export const DEFAULT_CARD_WIDTH_PX = 460;
export const MONTHS_PER_CARD_WIDTH = 24;
export const DAYS_PER_CARD_WIDTH = 30;
export const MONTH_SNAP_THRESHOLD = 1;
export const DAY_SNAP_THRESHOLD = 1;

export type DragIntent = "pending" | "drag" | "cancel";

export interface TouchSessionState {
  startedOnCardChrome: boolean;
  wasFocusedAtStart: boolean;
  didDrag: boolean;
  targetUnit: EditableDateUnit;
}

export interface TouchEndBehavior {
  preventDefault: boolean;
  refocusUnit: EditableDateUnit | null;
}

export function resolveTouchEndBehavior(session: TouchSessionState): TouchEndBehavior {
  if (session.didDrag) {
    return { preventDefault: true, refocusUnit: null };
  }
  if (session.startedOnCardChrome && session.wasFocusedAtStart) {
    return { preventDefault: true, refocusUnit: session.targetUnit };
  }
  return { preventDefault: false, refocusUnit: null };
}

/**
 * Classifies pointer movement before a horizontal scrub engages:
 * - Mouse/pen: activates once |dx| reaches DRAG_THRESHOLD_PX.
 * - Touch: uses a slightly larger threshold to absorb finger-pad jitter on taps,
 *   and cancels into native vertical page scroll if |dy| dominates |dx|.
 */
export function classifyDragIntent(dx: number, dy: number, pointerType: string): DragIntent {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (pointerType === "touch") {
    if (absY >= TOUCH_DRAG_THRESHOLD_PX && absY > absX) {
      return "cancel";
    }
    if (absX >= TOUCH_DRAG_THRESHOLD_PX && absX >= absY) {
      return "drag";
    }
    return "pending";
  }
  return absX >= DRAG_THRESHOLD_PX ? "drag" : "pending";
}

export const STEP_PX_BY_UNIT: Record<EditableDateUnit, number> = {
  year: 11,
  month: DEFAULT_CARD_WIDTH_PX / MONTHS_PER_CARD_WIDTH,
  day: DEFAULT_CARD_WIDTH_PX / DAYS_PER_CARD_WIDTH,
};

export function isEditableUnit(type: string | null | undefined): type is EditableDateUnit {
  return type === "year" || type === "month" || type === "day";
}

export function getStepPxForUnit(unit: EditableDateUnit, cardWidth: number): number {
  const safeWidth = Number.isFinite(cardWidth) && cardWidth > 0 ? cardWidth : DEFAULT_CARD_WIDTH_PX;
  if (unit === "month") return safeWidth / MONTHS_PER_CARD_WIDTH;
  if (unit === "day") return safeWidth / DAYS_PER_CARD_WIDTH;
  return STEP_PX_BY_UNIT[unit];
}

export function computeSnappedSteps(
  rawSteps: number,
  currentSteps: number,
  threshold: number,
): number {
  if (!Number.isFinite(rawSteps) || !Number.isFinite(threshold) || threshold <= 0) {
    return currentSteps;
  }
  let next = currentSteps;
  while (rawSteps - next >= threshold) {
    next += 1;
  }
  while (next - rawSteps >= threshold) {
    next -= 1;
  }
  return next;
}

export interface DragStepInput {
  baseIso: string;
  currentIso: string;
  unit: EditableDateUnit;
  appliedSteps: number;
  rawSteps: number;
  min: string;
  max: string;
}

export interface DragStepResult {
  nextSteps: number;
  nextIso: string;
  /** Intermediate adjacent ISO dates to step WebGL state through for continuous month/day deltas. */
  stepIsos: string[];
  /** Sub-step visual fraction in [-1, 1] for continuous month/day interpolation. */
  fraction: number;
  /** True when clamping at min/max prevented movement in the dragged direction. */
  clampedAtBoundary: boolean;
}

export function computeDragStepTransition(input: DragStepInput): DragStepResult {
  const { baseIso, currentIso, unit, appliedSteps, rawSteps, min, max } = input;

  const targetSteps =
    unit === "month"
      ? computeSnappedSteps(rawSteps, appliedSteps, MONTH_SNAP_THRESHOLD)
      : unit === "day"
        ? computeSnappedSteps(rawSteps, appliedSteps, DAY_SNAP_THRESHOLD)
        : Math.trunc(rawSteps);

  let nextSteps = appliedSteps;
  let nextIso = currentIso;
  const stepIsos: string[] = [];
  let clampedAtBoundary = false;

  if (targetSteps !== appliedSteps) {
    if (unit === "month" || unit === "day") {
      const stepDir = Math.sign(targetSteps - appliedSteps);
      let cursor = appliedSteps;
      let cursorIso = currentIso;
      while (cursor !== targetSteps) {
        const candidateStep = cursor + stepDir;
        const candidateIso = addDateSegment(baseIso, unit, candidateStep, min, max);
        if (candidateIso === cursorIso) {
          clampedAtBoundary = true;
          break;
        }
        cursor = candidateStep;
        cursorIso = candidateIso;
        if (parseIsoDate(candidateIso)) {
          stepIsos.push(candidateIso);
        }
      }
      nextSteps = cursor;
      nextIso = cursorIso;
    } else {
      const candidateIso = addDateSegment(baseIso, unit, targetSteps, min, max);
      if (candidateIso === currentIso) {
        clampedAtBoundary = true;
      } else {
        nextSteps = targetSteps;
        nextIso = candidateIso;
        if (parseIsoDate(candidateIso)) {
          stepIsos.push(candidateIso);
        }
      }
    }
  }

  let fraction = 0;
  if (unit === "month" || unit === "day") {
    fraction = Math.max(-1, Math.min(1, rawSteps - nextSteps));
    if (clampedAtBoundary) {
      fraction = 0;
    } else if (fraction > 0) {
      const peekNext = addDateSegment(baseIso, unit, nextSteps + 1, min, max);
      if (peekNext === nextIso) {
        fraction = 0;
        clampedAtBoundary = true;
      }
    } else if (fraction < 0) {
      const peekPrev = addDateSegment(baseIso, unit, nextSteps - 1, min, max);
      if (peekPrev === nextIso) {
        fraction = 0;
        clampedAtBoundary = true;
      }
    }
  }

  return {
    nextSteps,
    nextIso,
    stepIsos,
    fraction,
    clampedAtBoundary,
  };
}
