import { createContext, useContext } from "react";
import type { StageSurface } from "@/lib/define-experiment";

export interface StageContextValue {
  /** True when the stage is visible in the viewport (or open in standalone mode). */
  active: boolean;
  /** Current stage surface override ("auto" | "light" | "dark"). */
  surface: StageSurface;
}

const StageContext = createContext<StageContextValue>({
  active: true,
  surface: "auto",
});

export const StageProvider = StageContext.Provider;

export function useStageActive(): boolean {
  return useContext(StageContext).active;
}

export function useStageSurface(): StageSurface {
  return useContext(StageContext).surface;
}
