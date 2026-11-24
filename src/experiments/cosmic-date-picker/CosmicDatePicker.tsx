import { createDateInputController, DateInput, DateInputSegment } from "@ui-sdk/react/date-input";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import {
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStageActive } from "@/components/stage/StageContext";
import { CosmicScene } from "./CosmicScene";
import {
  type CalendarDate,
  type CosmicMode,
  clampDate,
  DEFAULT_MAX_YEAR,
  DEFAULT_MIN_YEAR,
  formatIsoDate,
  parseIsoDate,
} from "./date-math";

export interface CosmicDatePickerProps {
  label?: string;
  locale?: string;
  value?: string;
  defaultValue?: string;
  minYear?: number;
  maxYear?: number;
  onChange?: (isoDate: string) => void;
}

function isCosmicUnit(type: string): type is Exclude<CosmicMode, "idle"> {
  return type === "day" || type === "month" || type === "year";
}

export function CosmicDatePicker({
  label = "Birthday",
  locale = "ru-RU",
  value: controlledValue,
  defaultValue = "1995-02-16",
  minYear = DEFAULT_MIN_YEAR,
  maxYear = DEFAULT_MAX_YEAR,
  onChange,
}: CosmicDatePickerProps) {
  const stageActive = useStageActive();
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isoValue = controlledValue ?? uncontrolledValue;

  const calendarDate = useMemo<CalendarDate>(() => {
    const parsed = parseIsoDate(isoValue) ?? { year: 1995, month: 2, day: 16 };
    return clampDate(parsed, minYear, maxYear);
  }, [isoValue, minYear, maxYear]);

  const [activeMode, setActiveMode] = useState<CosmicMode>("idle");
  const [dateInputController] = useState(() => createDateInputController());

  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CosmicScene | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commitDate = useCallback(
    (next: CalendarDate) => {
      const clamped = clampDate(next, minYear, maxYear);
      const nextIso = formatIsoDate(clamped);
      if (controlledValue === undefined) {
        setUncontrolledValue(nextIso);
      }
      onChangeRef.current?.(nextIso);
    },
    [controlledValue, minYear, maxYear],
  );

  const initialConfigRef = useRef({
    date: calendarDate,
    minYear,
    maxYear,
  });
  const commitDateRef = useRef(commitDate);
  commitDateRef.current = commitDate;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: CosmicScene | null = null;
    try {
      scene = new CosmicScene({
        canvas,
        initialDate: initialConfigRef.current.date,
        minYear: initialConfigRef.current.minYear,
        maxYear: initialConfigRef.current.maxYear,
        onDateChange: (next) => commitDateRef.current(next),
      });
      sceneRef.current = scene;
    } catch {
      // Headless environments without WebGL keep the DateInput functional
      sceneRef.current = null;
    }

    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setDate(calendarDate);
  }, [calendarDate]);

  useEffect(() => {
    sceneRef.current?.setMode(activeMode);
  }, [activeMode]);

  useEffect(() => {
    sceneRef.current?.setBounds(minYear, maxYear);
  }, [minYear, maxYear]);

  useEffect(() => {
    sceneRef.current?.setActive(stageActive);
  }, [stageActive]);

  const handleCardBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !cardRef.current?.contains(nextTarget)) {
      setActiveMode("idle");
    }
  }, []);

  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && activeMode !== "idle") {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        setActiveMode("idle");
      }
    },
    [activeMode],
  );

  const minIso = `${String(minYear).padStart(4, "0")}-01-01`;
  const maxIso = `${String(maxYear).padStart(4, "0")}-12-31`;

  return (
    <Field className="w-full max-w-[480px]">
      <div
        ref={cardRef}
        data-cosmic-mode={activeMode}
        className="relative aspect-[16/10] w-full overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#03050a] shadow-[0_28px_80px_-24px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.1)]"
      >
        <canvas
          ref={canvasRef}
          className={
            activeMode === "idle"
              ? "absolute inset-0 h-full w-full select-none touch-none"
              : "absolute inset-0 h-full w-full cursor-grab select-none touch-none active:cursor-grabbing"
          }
        />

        <div className="pointer-events-none relative z-10 flex h-full flex-col justify-between p-6">
          <div className="flex items-start justify-start">
            <FieldLabel className="pointer-events-auto cursor-pointer select-none text-[15px] font-medium tracking-[-0.01em] text-white/70 transition-colors hover:text-white">
              {label}
            </FieldLabel>
          </div>

          <div className="flex items-end justify-end">
            <DateInput
              controller={dateInputController}
              locale={locale}
              value={formatIsoDate(calendarDate)}
              min={minIso}
              max={maxIso}
              onBlur={handleCardBlur}
              onKeyDown={handleCardKeyDown}
              onValueChange={(next) => {
                if (!next) return;
                const parsed = parseIsoDate(next);
                if (parsed) commitDate(parsed);
              }}
              className="pointer-events-auto inline-flex h-auto min-h-0 items-baseline gap-0 rounded-none border-0 bg-transparent p-0 font-sans text-[26px] leading-none font-medium tracking-[-0.02em] text-white/45 shadow-none outline-none tabular-nums sm:text-[30px] [&:has(:focus-visible)]:border-transparent [&:has(:focus-visible)]:outline-none"
            >
              {({ segments }) =>
                segments.map((segment) => {
                  if (!segment.editable) {
                    return (
                      <DateInputSegment
                        key={segment.key}
                        segment={segment}
                        className="select-none px-0 leading-none text-white/35"
                      />
                    );
                  }

                  const segmentUnit = isCosmicUnit(segment.type) ? segment.type : null;
                  const isActiveSegment = segmentUnit !== null && activeMode === segmentUnit;
                  const widthClass = segment.type === "year" ? "w-[4.05ch]" : "w-[2.05ch]";

                  return (
                    <DateInputSegment
                      key={segment.key}
                      segment={segment}
                      onFocus={() => {
                        if (segmentUnit !== null) {
                          setActiveMode(segmentUnit);
                        }
                      }}
                      className={`${widthClass} h-auto min-h-0 cursor-pointer rounded-none border-0 bg-transparent p-0 text-center font-inherit text-inherit leading-none outline-none transition-colors duration-200 hover:text-white/80 focus:bg-transparent focus:text-white focus:outline-none ${
                        isActiveSegment ? "text-white" : "text-white/45"
                      }`}
                    />
                  );
                })
              }
            </DateInput>
          </div>
        </div>
      </div>
    </Field>
  );
}
