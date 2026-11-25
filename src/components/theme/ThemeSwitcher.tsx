"use client";

import { Button } from "@ui-sdk/react/button";
import { usePreference } from "@ui-sdk/react/preferences";
import { colorScheme, getNextColorScheme } from "@/lib/theme";

export function ThemeSwitcher() {
  const { value } = usePreference(colorScheme);

  return (
    <Button
      aria-label={`Theme: ${value}. Change theme`}
      onClick={(event) => {
        colorScheme.set(getNextColorScheme(value), {
          reason: "press",
          event: event.nativeEvent,
        });
      }}
      className="fixed right-6 bottom-5 z-20 h-auto select-none border-0 bg-transparent p-0 font-mono text-[13px] font-normal tracking-[0.04em] text-muted hover:bg-transparent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fg"
    >
      {value}
    </Button>
  );
}
