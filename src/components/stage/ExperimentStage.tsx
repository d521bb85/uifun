import {
  Component,
  type ErrorInfo,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
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
  standalone?: boolean;
  stageRef?: (node: HTMLElement | null) => void;
}

export function ExperimentStage({
  experiment,
  standalone = false,
  stageRef,
}: ExperimentStageProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(standalone);

  useEffect(() => {
    if (standalone) {
      setActive(true);
      return;
    }
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setActive(entry.isIntersecting);
        }
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [standalone]);

  useEffect(() => {
    if (active) {
      experiment.preload();
    }
  }, [active, experiment]);

  const ExperimentComponent = experiment.Component;
  const Fallback = experiment.Fallback;

  return (
    <section
      ref={(node) => {
        containerRef.current = node;
        stageRef?.(node);
      }}
      data-slug={experiment.slug}
      className="flex min-h-dvh w-full items-center justify-center p-6"
    >
      <StageProvider value={{ active, surface: experiment.surface }}>
        <StageErrorBoundary>
          <Suspense fallback={Fallback ? <Fallback /> : null}>
            <ExperimentComponent />
          </Suspense>
        </StageErrorBoundary>
      </StageProvider>
    </section>
  );
}
