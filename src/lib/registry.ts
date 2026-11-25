import { type ComponentType, lazy } from "react";
import type { ExperimentDefinition, StageSurface } from "./define-experiment";

export interface ExperimentEntry {
  slug: string;
  title: string;
  date: string;
  tags: readonly string[];
  description?: string;
  surface: StageSurface;
  Component: ComponentType;
  Fallback?: ComponentType;
  preload: () => void;
}

interface ExperimentModule {
  default: ExperimentDefinition;
}

const modules = import.meta.glob<ExperimentModule>("../experiments/*/index.tsx", {
  eager: true,
});

function extractSlug(filePath: string): string {
  const match = filePath.match(/\/experiments\/([^/]+)\/index\.tsx$/);
  if (!match?.[1]) {
    throw new Error(`Invalid experiment module path: ${filePath}`);
  }
  return match[1];
}

export const experiments: readonly ExperimentEntry[] = Object.entries(modules)
  .map(([filePath, mod]): ExperimentEntry => {
    const def = mod.default;
    let Component: ComponentType;
    let triggerChunkLoad: (() => void) | undefined;
    if (def.load) {
      const load = def.load;
      let pendingLoad: Promise<{ default: ComponentType }> | null = null;
      const loadModule = () => {
        if (!pendingLoad) {
          pendingLoad = load().catch((err: unknown) => {
            pendingLoad = null;
            throw err;
          });
        }
        return pendingLoad;
      };
      Component = lazy(loadModule);
      triggerChunkLoad = () => {
        void loadModule();
      };
    } else {
      Component = def.component;
    }
    const preload = () => {
      triggerChunkLoad?.();
      def.preload?.();
    };
    return {
      slug: extractSlug(filePath),
      title: def.title,
      date: def.date,
      tags: def.tags,
      description: def.description,
      surface: def.surface ?? "auto",
      Component,
      Fallback: def.fallback,
      preload,
    };
  })
  .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));

export const allTags: readonly string[] = Array.from(
  new Set(experiments.flatMap((experiment) => experiment.tags)),
).sort((a, b) => a.localeCompare(b));

export function getExperimentBySlug(slug: string): ExperimentEntry | undefined {
  return experiments.find((experiment) => experiment.slug === slug);
}
