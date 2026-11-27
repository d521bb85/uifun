import { Component, type ErrorInfo, type ReactNode, Suspense, useEffect } from "react";
import type { ExperimentEntry } from "@/lib/registry";
import { StageProvider } from "./StageContext";

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
  useEffect(() => {
    if (mounted) {
      experiment.preload();
    }
  }, [mounted, experiment]);

  const ExperimentComponent = experiment.Component;
  const Fallback = experiment.Fallback;

  return (
    <section
      ref={stageRef}
      data-slug={experiment.slug}
      data-active={active ? "" : undefined}
      className="flex h-full w-full shrink-0 snap-start snap-always flex-col items-center justify-center overflow-hidden p-6 [contain:layout_style]"
    >
      {mounted ? (
        <div data-stage-content="" className="flex w-full items-center justify-center">
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
