import { defineExperiment } from "@/lib/define-experiment";

export default defineExperiment({
  title: "Cosmic Date Picker",
  date: "2026-11-24",
  tags: ["3D", "WebGL", "Date", "Interaction"],
  description:
    "Locale-aware date input where day, month, and year each open a 3D cosmic scale — lunar orbit, solar orbit, and a 150-year galactic solar helix.",
  surface: "dark",
  load: () => import("./CosmicDatePickerExperiment"),
});
