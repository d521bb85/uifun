import * as THREE from "three";
import type { AstroState } from "./astronomy";

export type AstroFocusMode = "idle" | "year" | "month" | "day";
export type FlightSpace = "cylindrical" | "cartesian";

export interface SetModeOptions {
  deferUntilValueSettled?: boolean;
}

export interface SceneValueAnimationState {
  mode: AstroFocusMode;
  flightActive: boolean;
  orbitError: number;
  dayElongError: number;
  dayAgeError: number;
  epochYearsError: number;
  sunYearPosError: number;
}

export interface ModeVisualTargets {
  wEarth: number;
  wOrbitalMoon: number;
  wSun: number;
  wMoon: number;
  wOcean: number;
  wGalactic: number;
  wMonthGuide: number;
  wYearGuide: number;
  wDayGuide: number;
  starHorizonClip: number;
  skyBright: number;
  skyGamma: number;
  skyReveal: number;
  sunScale: number;
}

export const TWO_PI = Math.PI * 2;
export const SCENE_INTERACTIVE_FLIGHT_PROGRESS = 0.5;
export const MAX_FRAME_DELTA_SECONDS = 0.05;
const FLIGHT_EASE_OUT_POWER = 1.75;

export function clampDeltaTime(nowMs: number, lastTimeMs: number): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastTimeMs)) return 0;
  return THREE.MathUtils.clamp((nowMs - lastTimeMs) / 1000, 0, MAX_FRAME_DELTA_SECONDS);
}

export function isSceneModeInteractive(
  currentMode: AstroFocusMode,
  targetMode: AstroFocusMode,
  pendingMode: AstroFocusMode | null,
  flightActive: boolean,
  flightProgress = 1,
): boolean {
  if (currentMode !== targetMode || pendingMode !== null) return false;
  if (!flightActive) return true;
  return flightProgress >= SCENE_INTERACTIVE_FLIGHT_PROGRESS;
}

export function isSceneValueAnimating(state: SceneValueAnimationState): boolean {
  if (state.mode === "month") {
    return state.orbitError > 0.02;
  }
  if (state.mode === "day") {
    return state.dayElongError > 0.02 || state.dayAgeError > 0.06;
  }
  if (state.mode === "year") {
    if (state.epochYearsError > 0.05) return true;
    if (!state.flightActive) {
      return state.sunYearPosError > 0.025;
    }
  }
  return false;
}

export function getModeVisualTargets(mode: AstroFocusMode): ModeVisualTargets {
  return {
    wEarth: mode === "idle" || mode === "month" ? 1 : 0,
    wOrbitalMoon: mode === "idle" || mode === "month" ? 1 : 0,
    wSun: mode === "idle" || mode === "month" || mode === "year" ? 1 : 0,
    wMoon: mode === "day" ? 1 : 0,
    wOcean: mode === "day" ? 1 : 0,
    wGalactic: mode === "year" ? 1 : 0,
    wMonthGuide: mode === "month" ? 1 : 0,
    wYearGuide: mode === "year" ? 1 : 0,
    wDayGuide: mode === "day" ? 1 : 0,
    starHorizonClip: mode === "day" ? 1 : 0,
    skyBright: mode === "year" ? 1.02 : mode === "month" ? 0.52 : mode === "day" ? 0.24 : 0.48,
    skyGamma: mode === "year" ? 0.74 : mode === "month" ? 0.83 : mode === "day" ? 0.88 : 0.84,
    skyReveal: mode === "year" ? 1 : mode === "month" ? 0.22 : mode === "day" ? 0.03 : 0.16,
    sunScale: mode === "year" ? 0.34 : mode === "month" ? 0.78 : 0.56,
  };
}

export function getTransitionDuration(from: AstroFocusMode, to: AstroFocusMode): number {
  if ((from === "idle" && to === "month") || (from === "month" && to === "idle")) return 0.94;
  if ((from === "idle" && to === "day") || (from === "day" && to === "idle")) return 1.02;
  if ((from === "idle" && to === "year") || (from === "year" && to === "idle")) return 1.04;
  if ((from === "month" && to === "year") || (from === "year" && to === "month")) return 1.04;
  if ((from === "month" && to === "day") || (from === "day" && to === "month")) return 1.12;
  return 1.14; // year <-> day
}

export function smootherstep(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * Asymmetric ease-in-out curve:
 * - Zero initial velocity (no frame-1 twitch), brisk acceleration into the flight
 * - Longer, velvety C2 ease-out cushion at the end so the camera settles smoothly into place
 */
export function flightEase(u: number): number {
  const c = THREE.MathUtils.clamp(u, 0, 1);
  const ss = c * c * (3 - 2 * c);
  return 1 - (1 - ss) ** FLIGHT_EASE_OUT_POWER;
}

export function windowProgress(u: number, start: number, end: number): number {
  return smootherstep((u - start) / Math.max(end - start, 1e-4));
}

export function phaseWeight(
  startVal: number,
  targetVal: number,
  u: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number,
): number {
  if (Math.abs(targetVal - startVal) < 1e-4) return targetVal;
  const p =
    targetVal > startVal ? windowProgress(u, inStart, inEnd) : windowProgress(u, outStart, outEnd);
  return THREE.MathUtils.lerp(startVal, targetVal, p);
}

/**
 * Smooth asymmetric Hermite flight interpolation:
 * - From rest (startVel = 0): zero initial velocity, swift glide, velvety C2 ease-out landing.
 * - Mid-flight redirect (startVel != 0): preserves incoming velocity seamlessly while curving
 *   to the new destination and settling softly at zero velocity & zero acceleration.
 */
export function quinticHermite(
  start: number,
  target: number,
  startVel: number,
  duration: number,
  u: number,
): number {
  const c = THREE.MathUtils.clamp(u, 0, 1);
  const c2 = c * c;
  const c3 = c2 * c;
  const c4 = c3 * c;
  const c5 = c4 * c;
  const s = flightEase(c);
  const m = c - 6 * c3 + 8 * c4 - 3 * c5;
  const delta = target - start;
  let velTerm = startVel * duration;
  // Softly damp carryover when reversing direction mid-flight so turns stay graceful with minimal overshoot
  if (velTerm * delta < 0) {
    velTerm *= 0.55;
  }
  const maxVelTerm = Math.max(Math.abs(delta) * 1.4, 0.35);
  velTerm = THREE.MathUtils.clamp(velTerm, -maxVelTerm, maxVelTerm);
  return start + delta * s + velTerm * m;
}

export function dirToYawPitch(dir: THREE.Vector3): [number, number] {
  const yaw = Math.atan2(-dir.x, -dir.z);
  const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.999, 0.999));
  return [yaw, pitch];
}

export function yawPitchToDir(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cosP = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP);
}

export function pointToSegmentDistanceXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-8) return Math.hypot(px - ax, pz - az);
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (dt <= 0) return current;
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function advanceSmoothLinear(
  current: number,
  target: number,
  velocity: number,
  maxSpeed: number,
  accel: number,
  arrivalBand: number,
  dt: number,
): [number, number] {
  if (dt <= 0) return [current, velocity];
  const diff = target - current;
  if (Math.abs(diff) < 1e-4 && Math.abs(velocity) < 1e-3) {
    return [target, 0];
  }

  // Cruise at a steady constant speed outside a tiny soft-landing band near target
  const speedScale = Math.min(1, Math.abs(diff) / arrivalBand);
  const desiredVelocity = Math.sign(diff) * maxSpeed * speedScale;

  // Ramp velocity smoothly so starts, stops, and direction reversals have zero jerk
  const maxVelStep = accel * dt;
  const velDiff = desiredVelocity - velocity;
  const nextVelocity =
    Math.abs(velDiff) <= maxVelStep ? desiredVelocity : velocity + Math.sign(velDiff) * maxVelStep;

  const nextPos = current + nextVelocity * dt;
  if ((diff > 0 && nextPos >= target) || (diff < 0 && nextPos <= target)) {
    return [target, 0];
  }

  return [nextPos, nextVelocity];
}

export function unwrapAngleNear(angle: number, reference: number): number {
  let diff = ((angle - reference + Math.PI) % TWO_PI) - Math.PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return reference + diff;
}

export function shortestAngleDelta(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % TWO_PI) - Math.PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return diff;
}

export function advanceSmoothAngleLinear(
  current: number,
  target: number,
  velocity: number,
  maxSpeed: number,
  accel: number,
  arrivalBand: number,
  dt: number,
): [number, number] {
  if (dt <= 0) return [current, velocity];
  const diff = shortestAngleDelta(current, target);
  if (Math.abs(diff) < 1e-4 && Math.abs(velocity) < 1e-3) {
    return [shortestAngleDelta(0, target), 0];
  }

  // Cruise at a steady constant angular speed outside a soft-landing band near target
  const speedScale = Math.min(1, Math.abs(diff) / arrivalBand);
  const desiredVelocity = Math.sign(diff) * maxSpeed * speedScale;

  // Ramp velocity smoothly so starts, stops, and direction reversals have zero jerk
  const maxVelStep = accel * dt;
  const velDiff = desiredVelocity - velocity;
  const nextVelocity =
    Math.abs(velDiff) <= maxVelStep ? desiredVelocity : velocity + Math.sign(velDiff) * maxVelStep;

  const step = nextVelocity * dt;
  if ((diff > 0 && step >= diff) || (diff < 0 && step <= diff)) {
    return [shortestAngleDelta(0, target), 0];
  }

  return [shortestAngleDelta(0, current + step), nextVelocity];
}

export function computeMoonRelAngle(state: AstroState): number {
  return shortestAngleDelta(state.solar.earthHeliocentricLongitudeRad, state.lunar.longitudeRad);
}

export function shortestCycleDelta(from: number, to: number, period: number): number {
  const half = period * 0.5;
  let diff = ((to - from + half) % period) - half;
  if (diff < -half) diff += period;
  return diff;
}

export function positiveAngleDelta(from: number, to: number): number {
  const diff = (((to - from) % TWO_PI) + TWO_PI) % TWO_PI;
  return diff === 0 ? TWO_PI : diff;
}

export function negativeAngleDelta(from: number, to: number): number {
  const diff = (((to - from) % TWO_PI) + TWO_PI) % TWO_PI;
  return diff === 0 ? -TWO_PI : diff - TWO_PI;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
