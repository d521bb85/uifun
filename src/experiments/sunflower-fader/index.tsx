import { defineExperiment } from "@/lib/define-experiment";
import SunflowerFaderDemo from "./SunflowerFaderDemo";

export default defineExperiment({
  title: "Sunflower Fader",
  date: "2026-11-27",
  tags: ["slider", "fader", "ui-sdk", "canvas", "illustration"],
  description:
    "A vertical watercolor-pencil sunflower fader that blooms from wilted shepherd's crook to radiant summer height.",
  component: SunflowerFaderDemo,
});
