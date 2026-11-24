import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { useState } from "react";
import { CosmicDatePicker } from "./CosmicDatePicker";

const LOCALES = [
  { value: "ru-RU", label: "RU" },
  { value: "en-US", label: "US" },
  { value: "de-DE", label: "DE" },
  { value: "ja-JP", label: "JP" },
] as const;

export default function CosmicDatePickerExperiment() {
  const [locale, setLocale] = useState<string>("ru-RU");
  const [date, setDate] = useState<string>("1995-02-16");

  return (
    <div className="flex w-full flex-col items-center justify-center gap-6 px-4 py-8">
      <CosmicDatePicker label="Birthday" locale={locale} value={date} onChange={setDate} />

      <div className="flex items-center gap-3">
        <span className="text-xs font-medium tracking-wide text-muted">Locale</span>
        <SegmentedControl
          aria-label="Date locale"
          value={locale}
          onValueChange={(next) => {
            if (next) setLocale(next);
          }}
          className="relative isolate inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-subtle p-1"
        >
          <SegmentedControlIndicator className="pointer-events-none absolute left-(--segmented-control-indicator-left) top-(--segmented-control-indicator-top) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-full bg-surface shadow-xs transition-[left,top,width,height] duration-200 data-[activation-direction=none]:transition-none" />
          {LOCALES.map((item) => (
            <SegmentedControlItem
              key={item.value}
              value={item.value}
              className="cursor-pointer rounded-full px-3 py-1 font-mono text-xs font-medium text-muted transition-colors hover:text-foreground data-checked:text-foreground"
            >
              {item.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
    </div>
  );
}
