import type { CSSProperties } from "react";
import { CARD_HEIGHT, CARD_WIDTH } from "./types";

const CARD_FRAME_STYLE: CSSProperties = {
  width: `min(${CARD_WIDTH}px, max(120px, calc((100dvh - 132px) * ${CARD_WIDTH / CARD_HEIGHT})), calc(100vw - 104px))`,
  aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}`,
};

export function SunflowerFaderSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading sunflower-fader"
      className="inline-flex w-auto min-w-0 flex-col items-center gap-4 select-none"
    >
      <div
        aria-hidden="true"
        style={CARD_FRAME_STYLE}
        className="rounded-[18px] bg-fg/[0.06] ring-1 ring-inset ring-line"
      />
      <div aria-hidden="true" className="flex h-[19.5px] items-center">
        <span className="block h-2.5 w-7 rounded-full bg-fg/[0.08]" />
      </div>
    </div>
  );
}
