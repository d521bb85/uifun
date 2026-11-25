import type { ComponentType } from "react";

export type StageSurface = "auto" | "light" | "dark";

export interface ExperimentBaseMeta {
  /** Human-readable title displayed in the feed and standalone view. */
  title: string;
  /** ISO date string (YYYY-MM-DD) used for chronological sorting (newest first). */
  date: string;
  /** Short category/concept tags used for feed filtering. */
  tags: readonly string[];
  /** Optional short note shown below the title. */
  description?: string;
  /** Preferred initial stage surface. Defaults to "auto" (follows system/app theme). */
  surface?: StageSurface;
  /** Lightweight control-shaped skeleton rendered while a lazy experiment chunk loads. */
  fallback?: ComponentType;
  /** Optional hook to warm external assets (textures, audio, etc.) before mount. */
  preload?: () => void;
}

export type ExperimentDefinition = ExperimentBaseMeta &
  (
    | {
        component: ComponentType;
        load?: never;
      }
    | {
        /** Lazy loader for heavy experiments (e.g. WebGL/Three.js) to split into its own chunk. */
        load: () => Promise<{ default: ComponentType }>;
        component?: never;
      }
  );

export function defineExperiment<T extends ExperimentDefinition>(definition: T): T {
  return definition;
}
