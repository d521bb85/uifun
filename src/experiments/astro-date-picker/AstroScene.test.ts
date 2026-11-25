import { describe, expect, it } from "vitest";
import {
  isSceneModeInteractive,
  isSceneValueAnimating,
  type SceneValueAnimationState,
} from "./AstroScene";

const SETTLED_BASE: SceneValueAnimationState = {
  mode: "idle",
  flightActive: false,
  orbitError: 0,
  dayElongError: 0,
  dayAgeError: 0,
  epochYearsError: 0,
  sunYearPosError: 0,
};

describe("isSceneValueAnimating", () => {
  it("never reports animating in idle mode", () => {
    expect(
      isSceneValueAnimating({
        ...SETTLED_BASE,
        mode: "idle",
        orbitError: 1,
        dayAgeError: 5,
        epochYearsError: 10,
      }),
    ).toBe(false);
  });

  it("tracks Earth orbit in month mode", () => {
    expect(isSceneValueAnimating({ ...SETTLED_BASE, mode: "month" })).toBe(false);
    expect(isSceneValueAnimating({ ...SETTLED_BASE, mode: "month", orbitError: 0.5 })).toBe(true);
    expect(
      isSceneValueAnimating({ ...SETTLED_BASE, mode: "month", dayAgeError: 5, epochYearsError: 5 }),
    ).toBe(false);
  });

  it("tracks lunar phase elongation and synodic age in day mode", () => {
    expect(isSceneValueAnimating({ ...SETTLED_BASE, mode: "day" })).toBe(false);
    expect(isSceneValueAnimating({ ...SETTLED_BASE, mode: "day", dayElongError: 0.2 })).toBe(true);
    expect(isSceneValueAnimating({ ...SETTLED_BASE, mode: "day", dayAgeError: 0.5 })).toBe(true);
    expect(
      isSceneValueAnimating({ ...SETTLED_BASE, mode: "day", orbitError: 1, epochYearsError: 5 }),
    ).toBe(false);
  });

  it("tracks galactic epoch and settled Sun drift in year mode without tripping during flight", () => {
    expect(isSceneValueAnimating({ ...SETTLED_BASE, mode: "year" })).toBe(false);
    expect(isSceneValueAnimating({ ...SETTLED_BASE, mode: "year", epochYearsError: 1 })).toBe(true);
    expect(
      isSceneValueAnimating({
        ...SETTLED_BASE,
        mode: "year",
        flightActive: false,
        sunYearPosError: 0.1,
      }),
    ).toBe(true);
    expect(
      isSceneValueAnimating({
        ...SETTLED_BASE,
        mode: "year",
        flightActive: true,
        sunYearPosError: 0.5,
      }),
    ).toBe(false);
  });
});

describe("isSceneModeInteractive", () => {
  it("allows interaction when settled or once flight reaches halfway", () => {
    expect(isSceneModeInteractive("month", "month", null, false, 1)).toBe(true);
    expect(isSceneModeInteractive("day", "day", null, false, 1)).toBe(true);
    expect(isSceneModeInteractive("year", "year", null, false, 1)).toBe(true);
    expect(isSceneModeInteractive("month", "month", null, true, 0.5)).toBe(true);
    expect(isSceneModeInteractive("day", "day", null, true, 0.75)).toBe(true);
    expect(isSceneModeInteractive("year", "year", null, true, 0.5)).toBe(true);
  });

  it("blocks interaction before halfway or while entering from another mode", () => {
    expect(isSceneModeInteractive("idle", "month", null, false, 1)).toBe(false);
    expect(isSceneModeInteractive("month", "day", null, false, 1)).toBe(false);
    expect(isSceneModeInteractive("month", "month", null, true, 0)).toBe(false);
    expect(isSceneModeInteractive("month", "month", null, true, 0.49)).toBe(false);
    expect(isSceneModeInteractive("month", "month", "day", false, 1)).toBe(false);
  });
});
