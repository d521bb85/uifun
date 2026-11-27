import {
  Component,
  type ErrorInfo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { ExperimentEntry } from "@/lib/registry";
import { StageProvider } from "./StageContext";
import { useStageKeyboardOffset } from "./useStageKeyboardOffset";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class StageErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ExperimentStage]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <p className="text-xs text-muted">{this.state.error.message}</p>;
    }
    return this.props.children;
  }
}

export interface ExperimentStageProps {
  experiment: ExperimentEntry;
  mounted: boolean;
  active: boolean;
  stageRef?: (node: HTMLElement | null) => void;
}

export function ExperimentStage({ experiment, mounted, active, stageRef }: ExperimentStageProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const setSectionRef = useCallback(
    (node: HTMLElement | null) => {
      sectionRef.current = node;
      stageRef?.(node);
    },
    [stageRef],
  );

  const keyboardOffsetY = useStageKeyboardOffset(sectionRef, contentRef, active, mounted);

  useEffect(() => {
    if (mounted) {
      experiment.preload();
    }
  }, [mounted, experiment]);

  const ExperimentComponent = experiment.Component;
  const Fallback = experiment.Fallback;

  return (
    <section
      ref={setSectionRef}
      data-slug={experiment.slug}
      data-active={active ? "" : undefined}
      className="relative flex h-full w-full shrink-0 snap-start snap-always flex-col items-center justify-center overflow-hidden p-6 [contain:layout_style]"
    >
      {mounted ? (
        <div
          ref={contentRef}
          data-stage-content=""
          data-keyboard-shifted={keyboardOffsetY !== 0 ? "" : undefined}
          style={
            keyboardOffsetY !== 0
              ? { transform: `translate3d(0, ${keyboardOffsetY}px, 0)` }
              : undefined
          }
          className="flex w-full items-center justify-center transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        >
          <StageProvider value={{ active, surface: experiment.surface }}>
            <StageErrorBoundary>
              <Suspense fallback={Fallback ? <Fallback /> : null}>
                <ExperimentComponent />
              </Suspense>
            </StageErrorBoundary>
          </StageProvider>
        </div>
      ) : Fallback ? (
        <Fallback />
      ) : null}
    </section>
  );
}
