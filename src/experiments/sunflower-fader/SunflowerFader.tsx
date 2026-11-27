"use client";

import {
  createSliderController,
  Slider,
  SliderControl,
  SliderThumb,
  SliderTrack,
  SliderValue,
  type SliderValueChangeDetails,
  type SliderValueCommitDetails,
} from "@ui-sdk/react/slider";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useStageActive } from "@/components/stage/StageContext";
import { cn } from "@/lib/cn";
import {
  createInitialSimState,
  getHeadNormalizedCardPos,
  isPointOnHead,
  stepSimState,
} from "./botanyPhysics";
import { clamp } from "./colorAndCurves";
import { renderSunflowerFrame } from "./renderFrame";
import { releaseLeafSpriteCache } from "./sunflowerPainter";
import {
  BLEED_X,
  BLEED_Y,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CARD_HEIGHT,
  CARD_WIDTH,
  HEAD_CARD_Y_MAX,
  HEAD_CARD_Y_MIN,
  type Point2D,
  type SunflowerSimState,
} from "./types";

export interface SunflowerFaderProps {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number, details: SliderValueChangeDetails) => void;
  onValueCommit?: (value: number, details: SliderValueCommitDetails) => void;
  label?: string;
  name?: string;
  form?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

const formatPercent = (v: number) => `${Math.round(v)}%`;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
const DRAG_ACTIVATION_PX = 6;
const WHEEL_COMMIT_DELAY_MS = 160;

const CARD_FRAME_STYLE: CSSProperties = {
  width: `min(${CARD_WIDTH}px, max(120px, calc((100dvh - 132px) * ${CARD_WIDTH / CARD_HEIGHT})), calc(100vw - 104px))`,
  aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}`,
};

const CANVAS_BLEED_STYLE: CSSProperties = {
  left: `${(-BLEED_X / CARD_WIDTH) * 100}%`,
  top: `${(-BLEED_Y / CARD_HEIGHT) * 100}%`,
  width: `${(CANVAS_WIDTH / CARD_WIDTH) * 100}%`,
  height: `${(CANVAS_HEIGHT / CARD_HEIGHT) * 100}%`,
};

const SLIDER_TRACK_BOUNDS_STYLE: CSSProperties = {
  top: `${(HEAD_CARD_Y_MAX / CARD_HEIGHT) * 100}%`,
  bottom: `${((CARD_HEIGHT - HEAD_CARD_Y_MIN) / CARD_HEIGHT) * 100}%`,
};

type ScaleTickTier = "anchor" | "major" | "minor";

const SCALE_TICKS: readonly { value: number; tier: ScaleTickTier }[] = Array.from(
  { length: 21 },
  (_, index) => {
    const value = index * 5;
    const tier: ScaleTickTier =
      value === 0 || value === 50 || value === 100
        ? "anchor"
        : value % 10 === 0
          ? "major"
          : "minor";
    return { value, tier };
  },
);

export function SunflowerFader({
  value,
  defaultValue = 75,
  onValueChange,
  onValueCommit,
  label = "Sunflower bloom",
  name,
  form,
  disabled,
  readOnly,
  className,
}: SunflowerFaderProps) {
  const isControlled = value !== undefined;
  const controlledValue = isControlled ? clamp(value, 0, 100) : undefined;
  const [initialValue] = useState(() => clamp(isControlled ? value : defaultValue, 0, 100));

  const [controller] = useState(() => createSliderController<number>());
  const [hoveringHead, setHoveringHead] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  const stageActive = useStageActive();
  const animateLoop = stageActive && pageVisible && !reducedMotion;

  const frameRef = useRef<HTMLDivElement | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const canvasRectRef = useRef<DOMRect | null>(null);

  const simRef = useRef<SunflowerSimState | null>(null);
  if (!simRef.current) {
    simRef.current = createInitialSimState(initialValue);
  }
  const initialSim = simRef.current;
  const [initialHeadDx] = useState(
    () => `${Math.round(getHeadNormalizedCardPos(initialSim.head).xPct - 50)}%`,
  );

  const isControlledRef = useRef(isControlled);
  isControlledRef.current = isControlled;

  const targetValueRef = useRef(initialValue);
  if (controlledValue !== undefined) {
    targetValueRef.current = controlledValue;
  }

  const animateLoopRef = useRef(animateLoop);
  animateLoopRef.current = animateLoop;

  const onValueCommitRef = useRef(onValueCommit);
  onValueCommitRef.current = onValueCommit;

  const pointerCanvasRef = useRef<Point2D | null>(null);
  const pressOriginClientRef = useRef<Point2D | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const hasDraggedRef = useRef(false);
  const hoverHeadRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const wheelAccumRef = useRef(0);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const lastModalityRef = useRef<"keyboard" | "pointer">("pointer");
  const lastHeadDxRef = useRef<string | null>(initialHeadDx);

  const syncHeadOffset = useCallback((sim: SunflowerSimState) => {
    const frameEl = frameRef.current;
    if (!frameEl) return;
    const { xPct } = getHeadNormalizedCardPos(sim.head);
    const quantized = `${Math.round(xPct - 50)}%`;
    if (lastHeadDxRef.current === quantized) return;
    lastHeadDxRef.current = quantized;
    frameEl.style.setProperty("--sunflower-head-dx", quantized);
  }, []);

  const paintCanvas = useCallback(
    (sim: SunflowerSimState) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(CANVAS_WIDTH * dpr);
      const targetH = Math.round(CANVAS_HEIGHT * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      let ctx = ctxRef.current;
      if (!ctx || ctx.canvas !== canvas) {
        ctx = canvas.getContext("2d");
        ctxRef.current = ctx;
      }
      if (!ctx) return;
      renderSunflowerFrame(ctx, sim, dpr);
      syncHeadOffset(sim);
    },
    [syncHeadOffset],
  );

  const paintSettledValue = useCallback(
    (nextValue: number, hoverHead = hoverHeadRef.current) => {
      const sim = simRef.current;
      if (!sim) return;
      sim.targetValue = nextValue;
      sim.displayValue = nextValue;
      sim.valueVelocity = 0;
      stepSimState(sim, 0, {
        targetValue: nextValue,
        dragging: false,
        hoverHead,
        pointerCanvas: pointerCanvasRef.current,
        reducedMotion: true,
      });
      paintCanvas(sim);
    },
    [paintCanvas],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      lastModalityRef.current = "keyboard";
    };
    const onWindowPointerDown = () => {
      lastModalityRef.current = "pointer";
    };
    const onWindowPointerMove = (event: globalThis.PointerEvent) => {
      if (!controlRef.current?.hasAttribute("data-dragging")) return;
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }
      const origin = pressOriginClientRef.current;
      if (origin && !hasDraggedRef.current) {
        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        if (dx * dx + dy * dy >= DRAG_ACTIVATION_PX * DRAG_ACTIVATION_PX) {
          hasDraggedRef.current = true;
        }
      }
      let rect = canvasRectRef.current;
      if (!rect) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        rect = canvas.getBoundingClientRect();
        canvasRectRef.current = rect;
      }
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerCanvasRef.current = {
        x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
      };
    };
    const clearCachedRect = () => {
      canvasRectRef.current = null;
    };
    const resetDragRefs = () => {
      canvasRectRef.current = null;
      pressOriginClientRef.current = null;
      activePointerIdRef.current = null;
      hasDraggedRef.current = false;
    };
    const onWindowPointerEnd = (event: globalThis.PointerEvent) => {
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }
      resetDragRefs();
      if (event.pointerType === "touch") {
        pointerCanvasRef.current = null;
        if (hoverHeadRef.current) {
          hoverHeadRef.current = false;
          setHoveringHead(false);
        }
        return;
      }
      const frameEl = frameRef.current;
      if (!frameEl) return;
      const rect = frameEl.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) {
        pointerCanvasRef.current = null;
        if (hoverHeadRef.current) {
          hoverHeadRef.current = false;
          setHoveringHead(false);
        }
      }
    };
    const onWindowBlur = () => {
      resetDragRefs();
      pointerCanvasRef.current = null;
      if (hoverHeadRef.current) {
        hoverHeadRef.current = false;
        setHoveringHead(false);
      }
    };
    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    window.addEventListener("pointermove", onWindowPointerMove, true);
    window.addEventListener("pointerup", onWindowPointerEnd, true);
    window.addEventListener("pointercancel", onWindowPointerEnd, true);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("resize", clearCachedRect, { passive: true });
    window.addEventListener("scroll", clearCachedRect, { passive: true, capture: true });
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("pointerdown", onWindowPointerDown, true);
      window.removeEventListener("pointermove", onWindowPointerMove, true);
      window.removeEventListener("pointerup", onWindowPointerEnd, true);
      window.removeEventListener("pointercancel", onWindowPointerEnd, true);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("resize", clearCachedRect);
      window.removeEventListener("scroll", clearCachedRect, true);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mq.matches;
    setReducedMotion(mq.matches);
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
      setReducedMotion(event.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const syncVisibility = () => {
      setPageVisible(document.visibilityState !== "hidden");
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;

    if (!animateLoop) {
      paintSettledValue(targetValueRef.current);
      return;
    }

    paintCanvas(sim);

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.05);
      lastTime = now;
      const dragging =
        (controlRef.current?.hasAttribute("data-dragging") ?? false) && hasDraggedRef.current;

      stepSimState(sim, dt, {
        targetValue: targetValueRef.current,
        dragging,
        hoverHead: hoverHeadRef.current,
        pointerCanvas: pointerCanvasRef.current,
        reducedMotion: reducedMotionRef.current,
      });
      paintCanvas(sim);

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [animateLoop, paintCanvas, paintSettledValue]);

  useEffect(() => {
    if (!animateLoop) {
      paintSettledValue(controlledValue ?? targetValueRef.current, hoveringHead);
    }
  }, [controlledValue, hoveringHead, animateLoop, paintSettledValue]);

  useEffect(() => {
    if (!disabled) return;
    pointerCanvasRef.current = null;
    if (hoverHeadRef.current) {
      hoverHeadRef.current = false;
      setHoveringHead(false);
    }
  }, [disabled]);

  // Release canvas GPU surfaces on unmount so mobile WebKit doesn't retain detached buffers.
  useEffect(() => {
    return () => {
      if (wheelCommitTimerRef.current !== null) {
        window.clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = null;
      }
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      ctxRef.current = null;
      if (simRef.current) {
        releaseLeafSpriteCache(simRef.current);
      }
    };
  }, []);

  // Native non-passive wheel listener so preventDefault stops page scroll only over the card.
  useEffect(() => {
    const frameEl = frameRef.current;
    if (!frameEl) return;

    const handleWheel = (event: WheelEvent) => {
      if (disabled || readOnly || controlRef.current?.hasAttribute("data-disabled")) return;
      if (event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaY) < 0.01 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();

      const raw =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * 120
            : event.deltaY;
      wheelAccumRef.current += -raw * 0.03;

      const wholeSteps = Math.trunc(wheelAccumRef.current);
      if (wholeSteps === 0) return;
      wheelAccumRef.current -= wholeSteps;

      const current = controller.getValue();
      const next = clamp(current + wholeSteps, 0, 100);
      if (next === current) {
        wheelAccumRef.current = 0;
        return;
      }
      const accepted = controller.setValue(next, { event });
      if (accepted) {
        if (wheelCommitTimerRef.current !== null) {
          window.clearTimeout(wheelCommitTimerRef.current);
        }
        wheelCommitTimerRef.current = window.setTimeout(() => {
          wheelCommitTimerRef.current = null;
          onValueCommitRef.current?.(next, {
            reason: "imperative",
            source: "mouse",
            thumb: 0,
          });
        }, WHEEL_COMMIT_DELAY_MS);
      }
    };

    frameEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => frameEl.removeEventListener("wheel", handleWheel);
  }, [controller, disabled, readOnly]);

  const handleValueChange = useCallback(
    (next: number, details: SliderValueChangeDetails) => {
      onValueChange?.(next, details);
      if (details.canceled || isControlledRef.current) {
        return;
      }
      targetValueRef.current = next;
      if (!animateLoopRef.current) {
        paintSettledValue(next);
      }
    },
    [onValueChange, paintSettledValue],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") return;
      if (disabled || controlRef.current?.hasAttribute("data-disabled")) return;
      if (controlRef.current?.hasAttribute("data-dragging")) return;

      const canvas = canvasRef.current;
      const sim = simRef.current;
      if (!canvas || !sim) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const canvasX = ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
      const canvasY = ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
      pointerCanvasRef.current = { x: canvasX, y: canvasY };

      const onHead = isPointOnHead(canvasX, canvasY, sim.head, 10);
      if (onHead !== hoverHeadRef.current) {
        hoverHeadRef.current = onHead;
        setHoveringHead(onHead);
      }
    },
    [disabled],
  );

  const handlePointerLeave = useCallback(() => {
    if (!controlRef.current?.hasAttribute("data-dragging")) {
      pointerCanvasRef.current = null;
    }
    if (hoverHeadRef.current) {
      hoverHeadRef.current = false;
      setHoveringHead(false);
    }
  }, []);

  const handleScaleTickClick = useCallback(
    (tickValue: number, event: MouseEvent<HTMLButtonElement>) => {
      if (disabled || readOnly || controlRef.current?.hasAttribute("data-disabled")) return;
      lastModalityRef.current = "pointer";
      setKeyboardFocus(false);
      const accepted = controller.setValue(tickValue, {
        reason: "track-press",
        event: event.nativeEvent,
      });
      if (accepted) {
        const nativeEvent = event.nativeEvent;
        const pointerType =
          typeof globalThis.PointerEvent === "function" &&
          nativeEvent instanceof globalThis.PointerEvent
            ? nativeEvent.pointerType
            : "mouse";
        const source = pointerType === "touch" ? "touch" : pointerType === "pen" ? "pen" : "mouse";
        onValueCommitRef.current?.(tickValue, {
          reason: "track-press",
          source,
          thumb: 0,
        });
      }
    },
    [controller, disabled, readOnly],
  );

  return (
    <Slider<number>
      orientation="vertical"
      min={0}
      max={100}
      step={1}
      largeStep={10}
      value={controlledValue}
      defaultValue={isControlled ? undefined : initialValue}
      onValueChange={handleValueChange}
      onValueCommit={onValueCommit}
      controller={controller}
      format={formatPercent}
      name={name}
      form={form}
      disabled={disabled}
      readOnly={readOnly}
      className={cn(
        "group/slider inline-flex w-auto min-w-0 flex-col items-center gap-4 select-none",
        className,
      )}
    >
      <div
        ref={frameRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="relative"
        style={{
          ...CARD_FRAME_STYLE,
          ["--sunflower-head-dx" as string]: initialHeadDx,
        }}
      >
        <div
          aria-hidden="true"
          data-slot="scale"
          className={cn(
            "absolute right-[calc(100%+14px)] w-7 touch-manipulation [-webkit-tap-highlight-color:transparent] group-data-disabled/slider:opacity-45",
            disabled && "opacity-45",
          )}
          style={SLIDER_TRACK_BOUNDS_STYLE}
        >
          {SCALE_TICKS.map((tick) => (
            <button
              key={tick.value}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              data-tick={tick.tier}
              data-value={tick.value}
              style={{ top: `${100 - tick.value}%` }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={(event) => handleScaleTickClick(tick.value, event)}
              className={cn(
                "group/tick absolute right-0 flex h-[5%] w-full -translate-y-1/2 appearance-none items-center justify-end border-0 bg-transparent p-0 pr-1.5 outline-none",
                disabled ? "cursor-not-allowed" : readOnly ? "cursor-default" : "cursor-pointer",
              )}
            >
              <span
                className={cn(
                  "block h-px origin-right rounded-full transition-[background-color,transform] duration-150 ease-out",
                  tick.tier === "anchor" && "w-3 bg-fg/42",
                  tick.tier === "major" && "w-2 bg-fg/28",
                  tick.tier === "minor" && "w-[5px] bg-fg/18",
                  !disabled &&
                    !readOnly &&
                    "group-hover/tick:scale-x-[1.2] group-hover/tick:bg-fg/80 group-active/tick:bg-fg",
                )}
              />
            </button>
          ))}
        </div>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="pointer-events-none absolute block max-w-none"
          style={CANVAS_BLEED_STYLE}
        />
        {/* Track keyboard vs pointer modality because Chrome matches :focus-visible on programmatic range input focus during drag. */}
        <SliderControl
          ref={controlRef}
          data-focus-keyboard={keyboardFocus ? "" : undefined}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            if (activePointerIdRef.current !== null) return;
            lastModalityRef.current = "pointer";
            setKeyboardFocus(false);
            activePointerIdRef.current = event.pointerId;
            pressOriginClientRef.current = { x: event.clientX, y: event.clientY };
            hasDraggedRef.current = false;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            canvasRectRef.current = rect;
            if (rect.width <= 0 || rect.height <= 0) return;
            pointerCanvasRef.current = {
              x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
              y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
            };
          }}
          onFocus={() => {
            setKeyboardFocus(lastModalityRef.current === "keyboard");
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setKeyboardFocus(false);
            }
          }}
          onKeyDown={(event) => {
            if (!MODIFIER_KEYS.has(event.key)) {
              lastModalityRef.current = "keyboard";
              setKeyboardFocus(true);
            }
          }}
          className={cn(
            "absolute inset-0 block h-full w-full rounded-[18px] p-0 touch-none [-webkit-tap-highlight-color:transparent]",
            "data-[focus-keyboard]:outline-2 data-[focus-keyboard]:outline-offset-4 data-[focus-keyboard]:outline-muted",
            "data-dragging:cursor-grabbing data-disabled:cursor-not-allowed",
            hoveringHead ? "cursor-grab" : "cursor-pointer",
          )}
        >
          <div className="absolute inset-x-0" style={SLIDER_TRACK_BOUNDS_STYLE}>
            <SliderTrack className="h-full w-full rounded-none bg-transparent">
              <SliderThumb
                aria-label={label}
                className={cn(
                  "ml-[var(--sunflower-head-dx,0%)] size-[78px] rounded-full border-0 bg-transparent [cursor:inherit]",
                  "data-dragging:cursor-grabbing data-disabled:cursor-not-allowed",
                  "has-[:focus-visible]:outline-none",
                )}
              />
            </SliderTrack>
          </div>
        </SliderControl>
      </div>

      <SliderValue className="font-mono text-[13px] font-normal tracking-[0.04em] tabular-nums text-muted select-none" />
    </Slider>
  );
}
