import { describe, expect, it } from "vitest";
import { defineExperiment } from "./define-experiment";
import { allTags, experiments, getExperimentBySlug } from "./registry";

function DummyExperiment() {
  return null;
}

describe("experiment registry", () => {
  it("exports valid experiment entries with unique slugs", () => {
    const slugs = experiments.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("derives sorted unique tags from registered experiments", () => {
    const expected = Array.from(new Set(experiments.flatMap((item) => item.tags))).sort((a, b) =>
      a.localeCompare(b),
    );
    expect(allTags).toEqual(expected);
  });

  it("registers astro-date-picker with the expected slug and title", () => {
    const entry = getExperimentBySlug("astro-date-picker");
    expect(entry).toBeDefined();
    expect(entry?.title).toBe("Astro Date Picker");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getExperimentBySlug("__nonexistent__")).toBeUndefined();
  });

  it("preserves metadata in defineExperiment", () => {
    const def = defineExperiment({
      title: "Sample",
      date: "2026-11-24",
      tags: ["demo"],
      component: DummyExperiment,
    });
    expect(def.title).toBe("Sample");
    expect(def.component).toBe(DummyExperiment);
  });
});
