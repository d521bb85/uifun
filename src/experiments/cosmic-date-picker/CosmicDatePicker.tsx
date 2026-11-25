"use client";

import { createDateInputController, DateInput, DateInputSegment } from "@ui-sdk/react/date-input";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import {
  type ComponentProps,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStageActive } from "@/components/stage/StageContext";
import { addDateSegment, computeCosmicState, getTodayIsoDate, parseIsoDate } from "./astronomy";
import styles from "./CosmicDatePicker.module.css";
import { type CosmicFocusMode, CosmicSceneRenderer } from "./CosmicScene";

type EditableDateUnit = "year" | "month" | "day";

const DRAG_THRESHOLD_PX = 5;
const MONTHS_PER_CARD_WIDTH = 24;
const DAYS_PER_CARD_WIDTH = 30;
const MONTH_SNAP_THRESHOLD = 1;
const DAY_SNAP_THRESHOLD = 1;
const STEP_PX_BY_UNIT: Record<EditableDateUnit, number> = {
  year: 11,
  month: 460 / MONTHS_PER_CARD_WIDTH,
  day: 460 / DAYS_PER_CARD_WIDTH,
};

function computeSnappedSteps(rawSteps: number, currentSteps: number, threshold: number): number {
  let next = currentSteps;
  while (rawSteps - next >= threshold) {
    next += 1;
  }
  while (next - rawSteps >= threshold) {
    next -= 1;
  }
  return next;
}

function isEditableUnit(type: string | null | undefined): type is EditableDateUnit {
  return type === "year" || type === "month" || type === "day";
}

type DateInputOnValueChange = NonNullable<ComponentProps<typeof DateInput>["onValueChange"]>;

export interface CosmicDatePickerProps {
  label?: string;
  value?: string | null;
  defaultValue?: string;
  onValueChange?: DateInputOnValueChange;
  min?: string;
  max?: string;
  locale?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
}

export function CosmicDatePicker({
  label = "Date",
  value,
  defaultValue,
  onValueChange,
  min = "0001-01-01",
  max = "9999-12-31",
  locale,
  name,
  disabled = false,
  readOnly = false,
  required = false,
}: CosmicDatePickerProps) {
  const stageActive = useStageActive();
  const [controller] = useState(createDateInputController);
  const [initialDefault] = useState<string | undefined>(() => defaultValue);
  const isControlled = value !== undefined;

  const [lastValidIso, setLastValidIso] = useState<string>(() => {
    if (isControlled && value && parseIsoDate(value)) return value;
    if (initialDefault && parseIsoDate(initialDefault)) return initialDefault;
    return getTodayIsoDate();
  });

  const [focusMode, setFocusMode] = useState<CosmicFocusMode>("idle");
  const [dragging, setDragging] = useState(false);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CosmicSceneRenderer | null>(null);

  const focusModeRef = useRef<CosmicFocusMode>("idle");
  const lastValidIsoRef = useRef(lastValidIso);
  const monthFractionRef = useRef(0);
  const dayFractionRef = useRef(0);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    originX: number;
    stepPx: number;
    initialFraction: number;
    appliedSteps: number;
    baseIso: string;
    unit: EditableDateUnit;
    active: boolean;
  } | null>(null);

  useEffect(() => {
    if (isControlled && value && parseIsoDate(value)) {
      setLastValidIso(value);
    }
  }, [isControlled, value]);

  useEffect(() => {
    focusModeRef.current = focusMode;
  }, [focusMode]);

  useEffect(() => {
    lastValidIsoRef.current = lastValidIso;
  }, [lastValidIso]);

  const cosmicState = useMemo(() => computeCosmicState(lastValidIso), [lastValidIso]);
  const initialCosmicStateRef = useRef(cosmicState);
  const initialStageActiveRef = useRef(stageActive);

  useEffect(() => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return;

    const scene = CosmicSceneRenderer.create(canvas, initialCosmicStateRef.current);
    if (!scene) return;
    rendererRef.current = scene;

    const motionQuery =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    scene.setReducedMotion(motionQuery?.matches ?? false);

    const handleMotionChange = (event: MediaQueryListEvent) => {
      scene.setReducedMotion(event.matches);
    };
    motionQuery?.addEventListener("change", handleMotionChange);

    const rect = card.getBoundingClientRect();
    scene.resize(rect.width || 460, rect.height || 290);
    scene.setActive(initialStageActiveRef.current);
    scene.start();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
              scene.resize(entry.contentRect.width, entry.contentRect.height);
            }
          })
        : null;
    resizeObserver?.observe(card);

    return () => {
      motionQuery?.removeEventListener("change", handleMotionChange);
      resizeObserver?.disconnect();
      scene.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setState(cosmicState);
  }, [cosmicState]);

  useEffect(() => {
    if (focusMode !== "month") {
      monthFractionRef.current = 0;
    }
    if (focusMode !== "day") {
      dayFractionRef.current = 0;
    }
    rendererRef.current?.setMode(focusMode);
  }, [focusMode]);

  useEffect(() => {
    rendererRef.current?.setActive(stageActive);
  }, [stageActive]);

  const handleValueChange: DateInputOnValueChange = (next, details) => {
    if (next && parseIsoDate(next)) {
      if (!dragRef.current?.active && focusModeRef.current === "month") {
        monthFractionRef.current = 0;
        rendererRef.current?.setMonthDragState(false, 0);
      }
      if (!dragRef.current?.active && focusModeRef.current === "day") {
        dayFractionRef.current = 0;
        rendererRef.current?.setDayDragState(false, 0);
      }
      setLastValidIso(next);
    }
    onValueChange?.(next, details);
  };

  const getFirstEditableUnit = (): EditableDateUnit => {
    const first = cardRef.current?.querySelector<HTMLElement>(
      '[data-slot="date-input-segment"]:not([data-type="literal"])',
    )?.dataset.type;
    return isEditableUnit(first) ? first : "month";
  };

  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const segmentEl = target?.closest<HTMLElement>('[data-slot="date-input-segment"]');
    const unit = segmentEl?.dataset.type;
    if (isEditableUnit(unit)) {
      setFocusMode(unit);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget as Node | null;
    if (nextFocused && cardRef.current?.contains(nextFocused)) {
      return;
    }
    setFocusMode("idle");
  };

  const endActiveDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.active && cardRef.current) {
      try {
        if (cardRef.current.hasPointerCapture?.(drag.pointerId)) {
          cardRef.current.releasePointerCapture(drag.pointerId);
        }
      } catch {
        // Capture may already have been dropped when crossing an iframe boundary.
      }
      setDragging(false);
    }
    if (drag.unit === "month") {
      // Leave Earth right where the user released; normalize only when leaving month mode (e.g. back to Hero)
      rendererRef.current?.setMonthDragState(false, monthFractionRef.current);
    } else {
      monthFractionRef.current = 0;
      rendererRef.current?.setMonthDragState(false, 0);
    }
    if (drag.unit === "day") {
      dayFractionRef.current = 0;
      rendererRef.current?.setDayDragState(false, 0);
    }
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const handleGlobalRelease = () => {
      if (dragRef.current) {
        endActiveDrag();
      }
    };

    window.addEventListener("pointerup", handleGlobalRelease, true);
    window.addEventListener("pointercancel", handleGlobalRelease, true);
    window.addEventListener("mouseup", handleGlobalRelease, true);
    window.addEventListener("blur", handleGlobalRelease);
    document.addEventListener("visibilitychange", handleGlobalRelease);

    return () => {
      window.removeEventListener("pointerup", handleGlobalRelease, true);
      window.removeEventListener("pointercancel", handleGlobalRelease, true);
      window.removeEventListener("mouseup", handleGlobalRelease, true);
      window.removeEventListener("blur", handleGlobalRelease);
      document.removeEventListener("visibilitychange", handleGlobalRelease);
    };
  }, [endActiveDrag]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    const isLabel = Boolean(target?.closest('[data-slot="field-label"]'));
    if (isLabel) {
      if (isFocusedInside()) {
        event.preventDefault();
      }
      return;
    }

    const isDateInput = Boolean(target?.closest('[data-slot="date-input"]'));
    const segmentEl = target?.closest<HTMLElement>('[data-slot="date-input-segment"]');
    const clickedType = segmentEl?.dataset.type;
    const clickedUnit = isEditableUnit(clickedType) ? clickedType : null;

    if (isDateInput && !clickedUnit) return;

    const activeUnit: EditableDateUnit =
      clickedUnit ??
      (focusModeRef.current === "idle" ? getFirstEditableUnit() : focusModeRef.current);

    if (!isDateInput) {
      // Keep pointerdown on the card background from blurring the active segment.
      event.preventDefault();
      setFocusMode(activeUnit);
      controller.focus(activeUnit);
    }

    if (readOnly) return;

    const cardWidth = cardRef.current?.getBoundingClientRect().width || 460;
    const stepPx =
      activeUnit === "month"
        ? cardWidth / MONTHS_PER_CARD_WIDTH
        : activeUnit === "day"
          ? cardWidth / DAYS_PER_CARD_WIDTH
          : STEP_PX_BY_UNIT[activeUnit];

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      originX: event.clientX,
      stepPx,
      initialFraction:
        activeUnit === "month"
          ? monthFractionRef.current
          : activeUnit === "day"
            ? dayFractionRef.current
            : 0,
      appliedSteps: 0,
      baseIso: controller.getValue() ?? lastValidIsoRef.current,
      unit: activeUnit,
      active: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    // Catch releases that happened outside an iframe or browser window
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      endActiveDrag();
      return;
    }

    if (!drag.active) {
      if (Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      // Anchor drag origin here so the first active frame starts smoothly at 0px without a threshold jump
      drag.originX = event.clientX;
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Ignore if capture is disallowed in the current browsing context.
      }
      if (focusModeRef.current !== drag.unit) {
        setFocusMode(drag.unit);
        controller.focus(drag.unit);
      }
    }

    const dx = event.clientX - drag.originX;
    const rawSteps = drag.initialFraction + dx / drag.stepPx;
    const nextSteps =
      drag.unit === "month"
        ? computeSnappedSteps(rawSteps, drag.appliedSteps, MONTH_SNAP_THRESHOLD)
        : drag.unit === "day"
          ? computeSnappedSteps(rawSteps, drag.appliedSteps, DAY_SNAP_THRESHOLD)
          : Math.trunc(rawSteps);

    if (nextSteps !== drag.appliedSteps) {
      if (drag.unit === "month" || drag.unit === "day") {
        // Step through adjacent months/days sequentially so WebGL neighbor deltas stay 100% continuous
        const stepDir = Math.sign(nextSteps - drag.appliedSteps);
        while (drag.appliedSteps !== nextSteps) {
          drag.appliedSteps += stepDir;
          const stepIso = addDateSegment(drag.baseIso, drag.unit, drag.appliedSteps, min, max);
          if (parseIsoDate(stepIso)) {
            rendererRef.current?.setState(computeCosmicState(stepIso));
          }
        }
      } else {
        drag.appliedSteps = nextSteps;
      }

      const nextIso = addDateSegment(drag.baseIso, drag.unit, nextSteps, min, max);
      controller.setValue(nextIso);
      if (parseIsoDate(nextIso)) {
        if (drag.unit !== "month" && drag.unit !== "day") {
          rendererRef.current?.setState(computeCosmicState(nextIso));
        }
        setLastValidIso(nextIso);
      }
    }

    if (drag.unit === "month") {
      const nextFraction = rawSteps - nextSteps;
      monthFractionRef.current = nextFraction;
      rendererRef.current?.setMonthDragState(true, nextFraction);
    } else if (drag.unit === "day") {
      const nextFraction = rawSteps - nextSteps;
      dayFractionRef.current = nextFraction;
      rendererRef.current?.setDayDragState(true, nextFraction);
    }
  };

  const isFocusedInside = () =>
    Boolean(document.activeElement && cardRef.current?.contains(document.activeElement));

  const handleLabelMouseDown = (event: MouseEvent<HTMLLabelElement>) => {
    if (disabled || event.button !== 0) return;
    if (isFocusedInside()) {
      // Prevent mousedown on the non-focusable label from blurring the active segment.
      event.preventDefault();
    }
  };

  const handleLabelClick = (event: MouseEvent<HTMLLabelElement>) => {
    if (disabled) return;
    if (isFocusedInside()) {
      event.preventDefault();
    }
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    endActiveDrag();
  };

  return (
    <Field
      ref={cardRef}
      className={styles.card}
      disabled={disabled}
      data-focus-mode={focusMode}
      data-dragging={dragging ? "" : undefined}
      onFocusCapture={handleFocusCapture}
      onBlur={handleBlur}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
      <div className={styles.scrim} aria-hidden="true" />
      <FieldLabel
        className={styles.label}
        onMouseDown={handleLabelMouseDown}
        onClick={handleLabelClick}
      >
        {label}
      </FieldLabel>
      <DateInput
        className={styles.dateInput}
        controller={controller}
        value={value}
        defaultValue={isControlled ? undefined : initialDefault}
        onValueChange={handleValueChange}
        min={min}
        max={max}
        locale={locale}
        name={name}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
      >
        {({ segments }) =>
          segments.map((segment) =>
            segment.editable ? (
              <DateInputSegment key={segment.key} segment={segment} className={styles.segment} />
            ) : (
              <DateInputSegment key={segment.key} segment={segment} className={styles.literal} />
            ),
          )
        }
      </DateInput>
    </Field>
  );
}
