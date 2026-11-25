"use client";

import { createDateInputController, DateInput, DateInputSegment } from "@ui-sdk/react/date-input";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import {
  type ComponentProps,
  type DragEvent,
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
import styles from "./AstroDatePicker.module.css";
import { AstroDatePickerSkeletonOverlay } from "./AstroDatePickerSkeleton";
import type { AstroFocusMode, AstroSceneRenderer } from "./AstroScene";
import { preloadAstroAssets, preloadAstroScene } from "./astroAssets";
import { computeAstroState, getTodayIsoDate, parseIsoDate } from "./astronomy";
import {
  classifyDragIntent,
  computeDragStepTransition,
  DEFAULT_CARD_WIDTH_PX,
  type EditableDateUnit,
  getStepPxForUnit,
  isEditableUnit,
} from "./dragMath";

type DateInputProps = ComponentProps<typeof DateInput>;
type DateInputOnValueChange = NonNullable<DateInputProps["onValueChange"]>;

export interface AstroDatePickerProps {
  label?: string;
  value?: string | null;
  defaultValue?: string;
  onValueChange?: DateInputOnValueChange;
  min?: string;
  max?: string;
  unavailable?: DateInputProps["unavailable"];
  locale?: string;
  name?: string;
  form?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  className?: string;
}

interface ActiveDragState {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  originX: number;
  stepPx: number;
  initialFraction: number;
  appliedSteps: number;
  baseIso: string;
  anchorDay: number | null;
  currentIso: string;
  unit: EditableDateUnit;
  active: boolean;
}

export function AstroDatePicker({
  label = "Date",
  value,
  defaultValue,
  onValueChange,
  min = "0001-01-01",
  max = "9999-12-31",
  unavailable,
  locale,
  name,
  form,
  disabled = false,
  readOnly = false,
  required = false,
  className,
}: AstroDatePickerProps) {
  const stageActive = useStageActive();
  const [controller] = useState(createDateInputController);
  const [initialDefault] = useState<string | undefined>(() => defaultValue);
  const isControlled = value !== undefined;

  const [lastValidIso, setLastValidIso] = useState<string>(() => {
    if (isControlled && value && parseIsoDate(value)) return value;
    if (initialDefault && parseIsoDate(initialDefault)) return initialDefault;
    return getTodayIsoDate();
  });

  const activeIso = isControlled && value && parseIsoDate(value) ? value : lastValidIso;

  const [focusMode, setFocusMode] = useState<AstroFocusMode>("idle");
  const [assetsReady, setAssetsReady] = useState(false);
  const [skeletonMounted, setSkeletonMounted] = useState(true);
  const [sceneInteractive, setSceneInteractive] = useState(false);
  const [dragging, setDragging] = useState(false);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<AstroSceneRenderer | null>(null);

  const focusModeRef = useRef<AstroFocusMode>("idle");
  const lastInputSourceRef = useRef<"keyboard" | "pointer">("pointer");
  const activeIsoRef = useRef(activeIso);
  const stageActiveRef = useRef(stageActive);
  const monthFractionRef = useRef(0);
  const dayFractionRef = useRef(0);
  const dragRef = useRef<ActiveDragState | null>(null);
  const suppressNextBlurRef = useRef(false);

  useEffect(() => {
    if (isControlled && value && parseIsoDate(value)) {
      setLastValidIso(value);
    }
  }, [isControlled, value]);

  useEffect(() => {
    focusModeRef.current = focusMode;
  }, [focusMode]);

  useEffect(() => {
    activeIsoRef.current = activeIso;
  }, [activeIso]);

  useEffect(() => {
    stageActiveRef.current = stageActive;
  }, [stageActive]);

  const astroState = useMemo(() => computeAstroState(activeIso), [activeIso]);
  const astroStateRef = useRef(astroState);
  astroStateRef.current = astroState;

  useEffect(() => {
    void preloadAstroAssets();
    const sceneModulePromise = preloadAstroScene();
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return;

    const motionQuery =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

    let SceneRendererCtor: typeof import("./AstroScene")["AstroSceneRenderer"] | null = null;
    let currentScene: AstroSceneRenderer | null = null;
    let unmounted = false;

    const syncCardSize = () => {
      if (!currentScene) return;
      const rect = card.getBoundingClientRect();
      currentScene.resize(rect.width || DEFAULT_CARD_WIDTH_PX, rect.height || 290);
    };

    const mountScene = () => {
      if (unmounted || !SceneRendererCtor) return;
      currentScene?.dispose();
      currentScene = SceneRendererCtor.create(canvas, astroStateRef.current);
      rendererRef.current = currentScene;

      if (!currentScene) {
        // WebGL unavailable (e.g. restricted or headless environment): still allow drag scrubbing
        setAssetsReady(true);
        setSceneInteractive(true);
        return;
      }

      currentScene.setOnAssetsReadyChange(setAssetsReady);
      currentScene.setOnSceneInteractiveChange(setSceneInteractive);
      currentScene.setOnContextRestored(mountScene);
      currentScene.setReducedMotion(motionQuery?.matches ?? false);
      currentScene.setPageVisible(typeof document === "undefined" ? true : !document.hidden);
      syncCardSize();
      if (focusModeRef.current !== "idle") {
        currentScene.setMode(focusModeRef.current);
      }
      currentScene.setActive(stageActiveRef.current);
      currentScene.start();
    };

    void sceneModulePromise
      .then((mod) => {
        if (unmounted) return;
        SceneRendererCtor = mod.AstroSceneRenderer;
        mountScene();
      })
      .catch(() => {
        if (unmounted) return;
        setAssetsReady(true);
        setSceneInteractive(true);
      });

    const handleMotionChange = (event: MediaQueryListEvent) => {
      currentScene?.setReducedMotion(event.matches);
    };
    motionQuery?.addEventListener("change", handleMotionChange);

    const handleVisibilityChange = () => {
      currentScene?.setPageVisible(typeof document === "undefined" ? true : !document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Watch devicePixelRatio changes (moving between displays or browser zoom)
    let dprMediaQuery: MediaQueryList | null = null;
    const handleDprChange = () => {
      syncCardSize();
      watchDpr();
    };
    const watchDpr = () => {
      dprMediaQuery?.removeEventListener("change", handleDprChange);
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        dprMediaQuery = null;
        return;
      }
      dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprMediaQuery.addEventListener("change", handleDprChange);
    };
    watchDpr();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
              currentScene?.resize(entry.contentRect.width, entry.contentRect.height);
            }
          })
        : null;
    resizeObserver?.observe(card);

    return () => {
      unmounted = true;
      motionQuery?.removeEventListener("change", handleMotionChange);
      dprMediaQuery?.removeEventListener("change", handleDprChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resizeObserver?.disconnect();
      currentScene?.dispose();
      currentScene = null;
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!assetsReady) {
      setSkeletonMounted(true);
      return;
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setSkeletonMounted(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSkeletonMounted(false);
    }, 450);
    return () => window.clearTimeout(timeoutId);
  }, [assetsReady]);

  useEffect(() => {
    rendererRef.current?.setState(astroState);
  }, [astroState]);

  useEffect(() => {
    if (focusMode !== "month") {
      monthFractionRef.current = 0;
    }
    if (focusMode !== "day") {
      dayFractionRef.current = 0;
    }
    rendererRef.current?.setMode(focusMode, {
      deferUntilValueSettled: lastInputSourceRef.current === "keyboard",
    });
  }, [focusMode]);

  useEffect(() => {
    rendererRef.current?.setActive(stageActive);
  }, [stageActive]);

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
      rendererRef.current?.setMonthDragState(false, monthFractionRef.current, null);
    } else {
      monthFractionRef.current = 0;
      rendererRef.current?.setMonthDragState(false, 0, null);
    }
    if (drag.unit === "day") {
      dayFractionRef.current = 0;
      rendererRef.current?.setDayDragState(false, 0);
    }
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (disabled) {
      endActiveDrag();
      setFocusMode("idle");
    }
  }, [disabled, endActiveDrag]);

  useEffect(() => {
    if (readOnly) {
      endActiveDrag();
    }
  }, [readOnly, endActiveDrag]);

  const handleValueChange: DateInputOnValueChange = (next, details) => {
    onValueChange?.(next, details);
    if (details.canceled) return;
    if (next && parseIsoDate(next)) {
      if (!dragRef.current?.active) {
        if (monthFractionRef.current !== 0) {
          monthFractionRef.current = 0;
          rendererRef.current?.setMonthDragState(false, 0, null);
        }
        if (dayFractionRef.current !== 0) {
          dayFractionRef.current = 0;
          rendererRef.current?.setDayDragState(false, 0);
        }
      }
      if (!isControlled) {
        setLastValidIso(next);
      }
    }
  };

  const getFirstEditableUnit = (): EditableDateUnit => {
    const first = cardRef.current?.querySelector<HTMLElement>(
      '[data-slot="date-input-segment"]:not([data-type="literal"])',
    )?.dataset.type;
    return isEditableUnit(first) ? first : "month";
  };

  const isFieldDisabled = () => disabled || Boolean(cardRef.current?.hasAttribute("data-disabled"));

  const focusUnitWithoutScroll = (unit: EditableDateUnit) => {
    const segmentEl = cardRef.current?.querySelector<HTMLElement>(
      `[data-slot="date-input-segment"][data-type="${unit}"]`,
    );
    if (segmentEl) {
      segmentEl.focus({ preventScroll: true });
    } else {
      controller.focus(unit);
    }
  };

  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    suppressNextBlurRef.current = false;
    const target = event.target as HTMLElement | null;
    const segmentEl = target?.closest<HTMLElement>('[data-slot="date-input-segment"]');
    const unit = segmentEl?.dataset.type;
    if (isEditableUnit(unit)) {
      setFocusMode(unit);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (suppressNextBlurRef.current) {
      suppressNextBlurRef.current = false;
      return;
    }
    const nextFocused = event.relatedTarget as Node | null;
    if (nextFocused && cardRef.current?.contains(nextFocused)) {
      return;
    }
    endActiveDrag();
    setFocusMode("idle");
  };

  const markKeyboardInput = () => {
    lastInputSourceRef.current = "keyboard";
  };

  const markPointerInput = useCallback(() => {
    lastInputSourceRef.current = "pointer";
  }, []);

  useEffect(() => {
    const handleGlobalPointerDown = (event: globalThis.PointerEvent) => {
      markPointerInput();
      if (
        focusModeRef.current !== "idle" &&
        !cardRef.current?.contains(event.target as Node | null)
      ) {
        endActiveDrag();
        setFocusMode("idle");
      }
    };
    const handleGlobalPointerEnd = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        endActiveDrag();
      }
    };
    const handleGlobalRelease = () => {
      if (dragRef.current) {
        endActiveDrag();
      }
    };

    window.addEventListener("pointerdown", handleGlobalPointerDown, true);
    window.addEventListener("pointerup", handleGlobalPointerEnd, true);
    window.addEventListener("pointercancel", handleGlobalPointerEnd, true);
    window.addEventListener("mouseup", handleGlobalRelease, true);
    window.addEventListener("blur", handleGlobalRelease);
    document.addEventListener("visibilitychange", handleGlobalRelease);

    return () => {
      window.removeEventListener("pointerdown", handleGlobalPointerDown, true);
      window.removeEventListener("pointerup", handleGlobalPointerEnd, true);
      window.removeEventListener("pointercancel", handleGlobalPointerEnd, true);
      window.removeEventListener("mouseup", handleGlobalRelease, true);
      window.removeEventListener("blur", handleGlobalRelease);
      document.removeEventListener("visibilitychange", handleGlobalRelease);
    };
  }, [endActiveDrag, markPointerInput]);

  useEffect(() => {
    if (!sceneInteractive && dragRef.current) {
      endActiveDrag();
    }
  }, [sceneInteractive, endActiveDrag]);

  const isFocusedInside = () =>
    Boolean(document.activeElement && cardRef.current?.contains(document.activeElement));

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isFieldDisabled() || event.button !== 0 || !event.isPrimary) return;
    if (dragRef.current?.active) return;
    lastInputSourceRef.current = "pointer";

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

    const renderer = rendererRef.current;
    const canDrag = renderer
      ? renderer.isModeInteractive(activeUnit)
      : focusModeRef.current === activeUnit;

    if (!isDateInput) {
      // On desktop/pen, keep focus on the active segment for immediate keyboard control without page scroll.
      // On touch, activate the 3D mode without forcing the mobile virtual keyboard to ambush the screen;
      // tapping any date segment or the label still opens the numeric keypad natively.
      if (event.pointerType !== "touch") {
        event.preventDefault();
        focusUnitWithoutScroll(activeUnit);
      } else if (isFocusedInside()) {
        suppressNextBlurRef.current = true;
        (document.activeElement as HTMLElement | null)?.blur();
      }
      setFocusMode(activeUnit);
    }
    renderer?.setMode(activeUnit);

    if (readOnly || !canDrag) return;

    const cardWidth = cardRef.current?.getBoundingClientRect().width || DEFAULT_CARD_WIDTH_PX;
    const stepPx = getStepPxForUnit(activeUnit, cardWidth);
    const baseIso = controller.getValue() ?? activeIsoRef.current;

    dragRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      originX: event.clientX,
      stepPx,
      initialFraction:
        activeUnit === "month"
          ? monthFractionRef.current
          : activeUnit === "day"
            ? dayFractionRef.current
            : 0,
      appliedSteps: 0,
      baseIso,
      anchorDay: parseIsoDate(baseIso)?.day ?? null,
      currentIso: baseIso,
      unit: activeUnit,
      active: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (rendererRef.current && !rendererRef.current.isModeInteractive(drag.unit)) {
      endActiveDrag();
      return;
    }

    // Catch releases that happened outside an iframe or browser window
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      endActiveDrag();
      return;
    }

    if (!drag.active) {
      const intent = classifyDragIntent(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
        drag.pointerType,
      );
      if (intent === "pending") return;
      if (intent === "cancel") {
        dragRef.current = null;
        return;
      }
      drag.active = true;
      // Anchor drag origin here so the first active frame starts smoothly at 0px without a threshold jump
      drag.originX = event.clientX;
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Ignore if capture is disallowed in the current browsing context.
      }
      if (drag.pointerType === "touch") {
        // Dismiss mobile virtual keyboard & prevent iOS selection callouts while scrubbing the 3D scene
        if (isFocusedInside()) {
          suppressNextBlurRef.current = true;
          (document.activeElement as HTMLElement | null)?.blur();
        }
        if (focusModeRef.current !== drag.unit) {
          setFocusMode(drag.unit);
        }
      } else if (focusModeRef.current !== drag.unit) {
        setFocusMode(drag.unit);
        focusUnitWithoutScroll(drag.unit);
      }
      if (drag.unit === "month") {
        rendererRef.current?.setMonthDragState(true, monthFractionRef.current, drag.anchorDay);
      }
    }

    const dx = event.clientX - drag.originX;
    const rawSteps = drag.initialFraction + dx / drag.stepPx;
    const transition = computeDragStepTransition({
      baseIso: drag.baseIso,
      currentIso: drag.currentIso,
      unit: drag.unit,
      appliedSteps: drag.appliedSteps,
      rawSteps,
      min,
      max,
    });

    if (transition.nextSteps !== drag.appliedSteps && transition.nextIso !== drag.currentIso) {
      const accepted = controller.setValue(transition.nextIso, { event: event.nativeEvent });
      if (accepted) {
        drag.appliedSteps = transition.nextSteps;
        drag.currentIso = transition.nextIso;

        if (!isControlled) {
          // Step through adjacent months/days sequentially so WebGL neighbor deltas stay 100% continuous
          for (const stepIso of transition.stepIsos) {
            rendererRef.current?.setState(computeAstroState(stepIso));
          }
          setLastValidIso(transition.nextIso);
        }
      }
    }

    if (transition.clampedAtBoundary) {
      // Re-anchor origin at the min/max boundary so reversing drag direction responds immediately
      drag.originX = event.clientX;
      drag.initialFraction = drag.appliedSteps;
    }

    if (drag.unit === "month") {
      monthFractionRef.current = transition.fraction;
      rendererRef.current?.setMonthDragState(true, transition.fraction, drag.anchorDay);
    } else if (drag.unit === "day") {
      dayFractionRef.current = transition.fraction;
      rendererRef.current?.setDayDragState(true, transition.fraction);
    }
  };

  const handleLabelMouseDown = (event: MouseEvent<HTMLLabelElement>) => {
    if (isFieldDisabled() || event.button !== 0) return;
    if (isFocusedInside()) {
      // Prevent mousedown on the non-focusable label from blurring the active segment.
      event.preventDefault();
    }
  };

  const handleLabelClick = (event: MouseEvent<HTMLLabelElement>) => {
    if (isFieldDisabled()) return;
    if (isFocusedInside()) {
      event.preventDefault();
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    endActiveDrag();
  };

  const cardClassName = className ? `${styles.card} ${className}` : styles.card;

  return (
    <Field
      ref={cardRef}
      className={cardClassName}
      disabled={disabled}
      data-assets-loading={assetsReady ? undefined : ""}
      data-focus-mode={focusMode}
      data-scene-ready={sceneInteractive && focusMode !== "idle" && !readOnly ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      onDragStart={handleDragStart}
      onKeyDownCapture={markKeyboardInput}
      onBeforeInputCapture={markKeyboardInput}
      onInputCapture={markKeyboardInput}
      onPointerDownCapture={markPointerInput}
      onFocusCapture={handleFocusCapture}
      onBlur={handleBlur}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
      {skeletonMounted ? <AstroDatePickerSkeletonOverlay ready={assetsReady} /> : null}
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
        unavailable={unavailable}
        locale={locale}
        name={name}
        form={form}
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
