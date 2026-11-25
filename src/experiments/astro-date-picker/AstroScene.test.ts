import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  isSceneModeInteractive,
  isSceneValueAnimating,
  type SceneValueAnimationState,
} from "./AstroScene";
import {
  createCoastalGeometry,
  createGalacticGuide,
  createGalacticRibbon,
  createHipparcosStarfield,
  createLunarGuide,
  createOrbitGuide,
} from "./sceneGeometry";
import {
  type AstroFocusMode,
  advanceSmoothAngleLinear,
  advanceSmoothLinear,
  clampDeltaTime,
  damp,
  dirToYawPitch,
  flightEase,
  getModeVisualTargets,
  getTransitionDuration,
  MAX_FRAME_DELTA_SECONDS,
  negativeAngleDelta,
  phaseWeight,
  pointToSegmentDistanceXZ,
  positiveAngleDelta,
  quinticHermite,
  shortestAngleDelta,
  shortestCycleDelta,
  smootherstep,
  TWO_PI,
  unwrapAngleNear,
  yawPitchToDir,
} from "./sceneMath";

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

describe("sceneMath", () => {
  it("clamps negative, huge, and non-finite frame deltas safely", () => {
    // Safari / Firefox rAF timestamp can precede performance.now()
    expect(clampDeltaTime(992, 1000)).toBe(0);
    expect(clampDeltaTime(1016, 1000)).toBeCloseTo(0.016, 6);
    expect(clampDeltaTime(5000, 1000)).toBe(MAX_FRAME_DELTA_SECONDS);
    expect(clampDeltaTime(Number.NaN, 1000)).toBe(0);
    expect(clampDeltaTime(1000, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("evaluates monotonic easing and flight Hermite curves with exact endpoints", () => {
    expect(smootherstep(-1)).toBe(0);
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 6);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(2)).toBe(1);

    expect(flightEase(0)).toBe(0);
    expect(flightEase(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 20; i += 1) {
      const next = flightEase(i / 20);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }

    expect(quinticHermite(2, 10, 0, 1, 0)).toBeCloseTo(2, 6);
    expect(quinticHermite(2, 10, 0, 1, 1)).toBeCloseTo(10, 6);
    expect(quinticHermite(2, 10, -12, 1, 0)).toBeCloseTo(2, 6);
    expect(quinticHermite(2, 10, -12, 1, 1)).toBeCloseTo(10, 6);
    expect(phaseWeight(0, 1, 0.1, 0.2, 0.8, 0, 0.3)).toBe(0);
    expect(phaseWeight(0, 1, 0.9, 0.2, 0.8, 0, 0.3)).toBe(1);
    expect(phaseWeight(1, 0, 0.3, 0.2, 0.8, 0, 0.3)).toBe(0);
  });

  it("round-trips direction vectors through yaw and pitch", () => {
    const samples = [
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(1, 0.3, -0.5).normalize(),
      new THREE.Vector3(-0.7, -0.4, 0.6).normalize(),
    ];
    const out = new THREE.Vector3();
    for (const sample of samples) {
      const [yaw, pitch] = dirToYawPitch(sample);
      yawPitchToDir(yaw, pitch, out);
      expect(out.distanceTo(sample)).toBeLessThan(1e-5);
    }
  });

  it("computes XZ point-to-segment distance accurately", () => {
    expect(pointToSegmentDistanceXZ(0, 0, -2, 3, 2, 3)).toBeCloseTo(3, 6);
    expect(pointToSegmentDistanceXZ(5, 0, 0, 0, 2, 0)).toBeCloseTo(3, 6);
    expect(pointToSegmentDistanceXZ(1, 2, 1, 2, 1, 2)).toBeCloseTo(0, 6);
  });

  it("handles angle wrapping and smooth linear/angular dampers safely", () => {
    expect(damp(0, 10, 5, 0)).toBe(0);
    expect(damp(0, 10, 5, -0.01)).toBe(0);
    expect(damp(0, 10, 5, 0.1)).toBeGreaterThan(0);

    expect(shortestAngleDelta(0.1, TWO_PI - 0.1)).toBeCloseTo(-0.2, 6);
    expect(unwrapAngleNear(0.1, TWO_PI - 0.1)).toBeCloseTo(TWO_PI + 0.1, 6);
    expect(shortestCycleDelta(29, 0.5, 29.53)).toBeCloseTo(1.03, 6);
    expect(positiveAngleDelta(0, 0)).toBeCloseTo(TWO_PI, 6);
    expect(negativeAngleDelta(0, 0)).toBeCloseTo(-TWO_PI, 6);

    let pos = 0;
    let vel = 0;
    for (let i = 0; i < 400; i += 1) {
      [pos, vel] = advanceSmoothLinear(pos, 1, vel, 0.5, 2.0, 0.1, 0.016);
    }
    expect(pos).toBeCloseTo(1, 4);
    expect(vel).toBe(0);

    let angle = Math.PI - 0.2;
    let angVel = 0;
    const target = -Math.PI + 0.2;
    for (let i = 0; i < 200; i += 1) {
      [angle, angVel] = advanceSmoothAngleLinear(angle, target, angVel, 1.2, 4.0, 0.2, 0.016);
    }
    expect(Math.abs(shortestAngleDelta(angle, target))).toBeLessThan(1e-3);
    expect(angVel).toBe(0);
  });

  it("provides symmetric transition durations and valid visual targets for every mode", () => {
    const modes: AstroFocusMode[] = ["idle", "year", "month", "day"];
    for (const a of modes) {
      const targets = getModeVisualTargets(a);
      expect(targets.skyBright).toBeGreaterThan(0);
      expect(targets.sunScale).toBeGreaterThan(0);
      for (const b of modes) {
        if (a !== b) {
          expect(getTransitionDuration(a, b)).toBe(getTransitionDuration(b, a));
          expect(getTransitionDuration(a, b)).toBeGreaterThan(0.5);
        }
      }
    }
  });
});

describe("sceneGeometry", () => {
  it("builds finite, properly indexed geometries and registers every resource for disposal", () => {
    const collector = {
      geometries: [] as THREE.BufferGeometry[],
      materials: [] as THREE.Material[],
    };

    const starfield = createHipparcosStarfield(0.5, collector);
    const galacticRibbon = createGalacticRibbon(collector);
    const orbitGuide = createOrbitGuide(0, collector);
    const galacticGuide = createGalacticGuide(collector);
    const lunarGuide = createLunarGuide(14, collector);
    const coastalGeo = createCoastalGeometry(collector);

    expect(starfield.points.frustumCulled).toBe(false);
    expect(galacticRibbon.group.children[0]?.frustumCulled).toBe(false);
    expect(orbitGuide.mesh.visible).toBe(false);
    expect(galacticGuide.mesh.visible).toBe(false);
    expect(lunarGuide.mesh.visible).toBe(false);
    expect(coastalGeo.boundingSphere).not.toBeNull();

    expect(collector.geometries.length).toBe(6);
    expect(collector.materials.length).toBe(5);

    for (const geo of collector.geometries) {
      const pos = geo.getAttribute("position");
      expect(pos).toBeDefined();
      expect(pos.count).toBeGreaterThan(0);
      for (let i = 0; i < Math.min(pos.array.length, 300); i += 1) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }
      const index = geo.getIndex();
      if (index) {
        for (let i = 0; i < index.count; i += 1) {
          const v = index.getX(i);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(pos.count);
        }
      }
      geo.dispose();
    }
    for (const mat of collector.materials) {
      mat.dispose();
    }
  });
});
