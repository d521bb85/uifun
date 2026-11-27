export const CARD_WIDTH = 224;
export const CARD_HEIGHT = 536;
export const CARD_RADIUS = 18;
export const BLEED_X = 48;
export const BLEED_Y = 32;
export const CANVAS_WIDTH = 320;
export const CANVAS_HEIGHT = 600;
export const HEAD_CARD_Y_MIN = 416;
export const HEAD_CARD_Y_MAX = 98;

export interface Point2D {
  x: number;
  y: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface PhasedProgress {
  raw: number;
  warmth: number;
  stemUncurl: number;
  stemGrow: number;
  headLift: number;
  leafUnfurl: number;
  bloom: number;
  wildflower: number;
  ecosystem: number;
}

export interface StemNode {
  x: number;
  y: number;
  tx: number;
  ty: number;
  radius: number;
  t: number;
}

export interface LeafPose {
  id: number;
  stemT: number;
  side: -1 | 1;
  attach: Point2D;
  petioleEnd: Point2D;
  tip: Point2D;
  angle: number;
  length: number;
  width: number;
  droop: number;
  curl: number;
  turgor: number;
  twist: number;
  zOrder: number;
  colorMix: number;
}

export interface HeadPose {
  center: Point2D;
  neck: Point2D;
  radius: number;
  diskRadius: number;
  pitch: number;
  yaw: number;
  roll: number;
  bloomOpen: number;
  petalCurl: number;
  petalDroop: number;
  petalLength: number;
  vitality: number;
}

export interface CloudState {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  opacity: number;
  seed: number;
}

export interface GrassBlade {
  id: number;
  baseX: number;
  baseY: number;
  height: number;
  lean: number;
  bend: number;
  thickness: number;
  layer: "back" | "mid" | "front";
  kind: "grass" | "twig" | "weed" | "wildflower";
  seed: number;
  phase: number;
  bloomThreshold: number;
  flowerHue: number;
}

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  kind: "dust" | "pollen";
}

export interface InsectState {
  active: boolean;
  kind: "bee" | "butterfly";
  x: number;
  y: number;
  vx: number;
  vy: number;
  wingPhase: number;
  facing: -1 | 1;
  opacity: number;
  scale: number;
  cooldown: number;
  progress: number;
  startX: number;
  endX: number;
  baseY: number;
  arcHeight: number;
  hovering: number;
  tilt: number;
  glide: number;
}

export interface SunflowerSimState {
  targetValue: number;
  displayValue: number;
  valueVelocity: number;
  time: number;
  boilStep: number;
  wind: number;
  gust: number;
  hoverHead: boolean;
  dragging: boolean;
  pointerCanvas: Point2D | null;
  phases: PhasedProgress;
  stem: StemNode[];
  leaves: LeafPose[];
  head: HeadPose;
  clouds: CloudState[];
  grass: GrassBlade[];
  particles: Particle[];
  insect: InsectState;
}

export interface SunflowerPalette {
  skyTop: RGB;
  skyMid: RGB;
  skyHorizon: RGB;
  cloudFill: RGB;
  sunGlow: RGB;
  grassBack: RGB;
  grassMid: RGB;
  grassFront: RGB;
  twigColor: RGB;
  stemBase: RGB;
  stemHighlight: RGB;
  stemOutline: RGB;
  leafBase: RGB;
  leafShadow: RGB;
  leafHighlight: RGB;
  leafVein: RGB;
  sepalFill: RGB;
  petalInner: RGB;
  petalOuter: RGB;
  petalTip: RGB;
  petalShadow: RGB;
  diskCenter: RGB;
  diskMid: RGB;
  diskEdge: RGB;
  outlineInk: RGB;
  paperBg: RGB;
}

export interface SimStepInput {
  targetValue: number;
  dragging: boolean;
  hoverHead: boolean;
  pointerCanvas: Point2D | null;
  reducedMotion: boolean;
}
