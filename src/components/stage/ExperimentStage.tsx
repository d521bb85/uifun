import { Link } from "@tanstack/react-router";
import { Button } from "@ui-sdk/react/button";
import { Toggle } from "@ui-sdk/react/toggle";
import { ArrowUpRight, Grid2x2, Moon, RotateCcw, Sun } from "lucide-react";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import type { StageSurface } from "@/lib/define-experiment";
import type { ExperimentEntry } from "@/lib/registry";
import { StageProvider } from "./StageContext";

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey: number;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class StageErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ExperimentStage]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex max-w-md flex-col items-center gap-2 text-center">
          <p className="font-mono text-xs uppercase tracking-wider text-muted">Render error</p>
          <p className="text-sm text-foreground">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface ExperimentStageProps {
  experiment: ExperimentEntry;
  standalone?: boolean;
  focused?: boolean;
  stageRef?: (node: HTMLElement | null) => void;
}

export function ExperimentStage({
  experiment,
  standalone = false,
  focused = false,
  stageRef,
}: ExperimentStageProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(standalone);
  const [resetKey, setResetKey] = useState(0);
  const [surface, setSurface] = useState<StageSurface>(experiment.surface);
  const [showGrid, setShowGrid] = useState(true);

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

  const cycleSurface = () => {
    setSurface((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const ExperimentComponent = experiment.Component;

  return (
    <article
      ref={(node) => {
        containerRef.current = node;
        stageRef?.(node);
      }}
      data-slug={experiment.slug}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-colors",
        focused && "ring-2 ring-foreground/20",
        standalone && "min-h-[calc(100dvh-7rem)]",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-sm font-medium tracking-tight text-foreground">
              {experiment.title}
            </h2>
            <time dateTime={experiment.date} className="shrink-0 font-mono text-[11px] text-muted">
              {experiment.date}
            </time>
          </div>
          {experiment.description ? (
            <p className="mt-0.5 truncate text-xs text-muted">{experiment.description}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <Toggle
            aria-label="Toggle stage dot grid"
            pressed={showGrid}
            onPressedChange={setShowGrid}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-subtle hover:text-foreground data-pressed:bg-surface-subtle data-pressed:text-foreground"
          >
            <Grid2x2 className="size-3.5" />
          </Toggle>

          <Button
            aria-label="Toggle stage surface theme"
            onClick={cycleSurface}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-subtle hover:text-foreground"
          >
            {surface === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>

          <Button
            aria-label="Reset experiment state"
            onClick={() => setResetKey((k) => k + 1)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-subtle hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
          </Button>

          {!standalone ? (
            <Link
              to="/e/$slug"
              params={{ slug: experiment.slug }}
              aria-label={`Open ${experiment.title} standalone`}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-subtle hover:text-foreground"
            >
              <ArrowUpRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </header>

      <div
        data-stage-surface={surface === "auto" ? undefined : surface}
        className={cn(
          "relative flex flex-1 items-center justify-center bg-surface p-8 text-foreground transition-colors sm:p-12",
          standalone ? "min-h-[60dvh]" : "min-h-[360px] sm:min-h-[420px]",
          showGrid && "stage-grid",
        )}
      >
        <StageProvider value={{ active, surface }}>
          <StageErrorBoundary resetKey={resetKey}>
            <Suspense
              fallback={<span className="font-mono text-xs text-muted">Loading experiment...</span>}
            >
              <ExperimentComponent key={resetKey} />
            </Suspense>
          </StageErrorBoundary>
        </StageProvider>
      </div>

      {experiment.tags.length > 0 ? (
        <footer className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
          {experiment.tags.map((tag) => (
            <Link
              key={tag}
              to="/"
              search={{ tag }}
              className="rounded-md bg-surface-subtle px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:text-foreground"
            >
              #{tag}
            </Link>
          ))}
        </footer>
      ) : null}
    </article>
  );
}
