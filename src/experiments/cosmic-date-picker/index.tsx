import { defineExperiment } from "@/lib/define-experiment";

export default defineExperiment({
  title: "Cosmic Date Picker",
  date: "2026-11-24",
  tags: ["date-picker", "ui-sdk", "webgl", "astronomy"],
  description:
    "Credit-card date picker driven by celestial mechanics: solar galactic drift for year, heliocentric Earth orbit for month, lunar phase and ocean tide for day.",
  load: () => import("./CosmicDatePickerDemo"),
});
