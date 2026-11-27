import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExperimentDefinition } from "@/lib/define-experiment";
import {
  createInitialSimState,
  getHeadNormalizedCardPos,
  isPointOnHead,
  stepSimState,
} from "./botanyPhysics";
import { computePhasedProgress, getPalette, lerp, rgbToCss } from "./colorAndCurves";
import experimentMeta from "./index";
import { renderSunflowerFrame } from "./renderFrame";
import { SunflowerFader } from "./SunflowerFader";
import SunflowerFaderDemo from "./SunflowerFaderDemo";
import {
  BLEED_X,
  BLEED_Y,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CARD_HEIGHT,
  CARD_WIDTH,
  HEAD_CARD_Y_MAX,
  HEAD_CARD_Y_MIN,
} from "./types";

describe("SunflowerFader SSR & ui-sdk wiring", () => {
  it("renders vertical ui-sdk Slider cleanly during SSR with aligned track bounds", () => {
    const html = renderToString(<SunflowerFader />);

    expect(html).toContain('data-slot="slider"');
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain('data-slot="slider-control"');
    expect(html).toContain('data-slot="slider-track"');
    expect(html).toContain('data-slot="slider-thumb"');
    expect(html).toContain('aria-label="Sunflower bloom"');
    expect(html).toContain('role="slider"');
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuetext="75%"');
    expect(html).toContain('data-slot="slider-value"');
    expect(html).toContain(">75%</output>");
    expect(html).toContain("text-muted");
    expect(html).toContain("data-[focus-keyboard]:outline-muted");
    expect(html).not.toContain("has-[:focus-visible]:outline-muted");
    expect(html).not.toContain("data-focus-keyboard=");
    expect(html).toContain("<canvas");

    const expectedTop = `${(HEAD_CARD_Y_MAX / CARD_HEIGHT) * 100}%`;
    const expectedBottom = `${((CARD_HEIGHT - HEAD_CARD_Y_MIN) / CARD_HEIGHT) * 100}%`;
    expect(html).toContain(`top:${expectedTop}`);
    expect(html).toContain(`bottom:${expectedBottom}`);
  });

  it("renders a clickable numberless left-side 0..100 fader scale aligned to the flower disk center range", () => {
    const html = renderToString(<SunflowerFader />);
    const scaleMatch = html.match(/<div[^>]*data-slot="scale"[^>]*>([\s\S]*?)<\/div>/);
    expect(scaleMatch).not.toBeNull();

    const scaleOpeningTag = html.match(/<div[^>]*data-slot="scale"[^>]*>/)?.[0] ?? "";
    const scaleInnerHtml = scaleMatch?.[1] ?? "";

    expect(scaleOpeningTag).toContain('aria-hidden="true"');
    expect(scaleOpeningTag).toContain("touch-manipulation");
    expect(scaleOpeningTag).toContain("[-webkit-tap-highlight-color:transparent]");
    expect(scaleOpeningTag).toContain(`top:${(HEAD_CARD_Y_MAX / CARD_HEIGHT) * 100}%`);
    expect(scaleOpeningTag).toContain(
      `bottom:${((CARD_HEIGHT - HEAD_CARD_Y_MIN) / CARD_HEIGHT) * 100}%`,
    );

    const tickButtons =
      scaleInnerHtml.match(/<button[^>]*data-tick="[^"]+"[^>]*><span[^>]*><\/span><\/button>/g) ??
      [];
    expect(tickButtons).toHaveLength(21);

    const anchorTicks = scaleInnerHtml.match(/data-tick="anchor"/g) ?? [];
    const majorTicks = scaleInnerHtml.match(/data-tick="major"/g) ?? [];
    const minorTicks = scaleInnerHtml.match(/data-tick="minor"/g) ?? [];
    expect(anchorTicks).toHaveLength(3);
    expect(majorTicks).toHaveLength(8);
    expect(minorTicks).toHaveLength(10);

    expect(scaleInnerHtml).toContain('tabindex="-1"');
    expect(scaleInnerHtml).toContain('data-tick="anchor" data-value="0" style="top:100%"');
    expect(scaleInnerHtml).toContain('data-tick="anchor" data-value="50" style="top:50%"');
    expect(scaleInnerHtml).toContain('data-tick="anchor" data-value="100" style="top:0%"');

    const scaleText = scaleInnerHtml.replace(/<[^>]+>/g, "").trim();
    expect(scaleText).toBe("");

    const disabledHtml = renderToString(<SunflowerFader disabled />);
    const disabledScale =
      disabledHtml.match(/<div[^>]*data-slot="scale"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(disabledScale).toContain("disabled");
  });

  it("supports controlled value, custom label, form attributes, disabled, and readOnly", () => {
    const html = renderToString(
      <SunflowerFader
        value={100}
        label="Sun level"
        name="bloom"
        form="garden-form"
        disabled
        readOnly
        className="custom-fader"
      />,
    );

    expect(html).toContain('aria-label="Sun level"');
    expect(html).toContain('aria-valuetext="100%"');
    expect(html).toContain(">100%</output>");
    expect(html).toContain("data-disabled");
    expect(html).toContain('name="bloom"');
    expect(html).toContain('form="garden-form"');
    expect(html).toContain("custom-fader");
  });

  it("does not override host surface or inject a full-page paper backdrop", () => {
    const html = renderToString(<SunflowerFaderDemo />);
    expect(html).not.toContain("bg-[#f6f4ef]");
    expect(html).not.toContain("fixed inset-0");
    expect(html).toContain(">75%</output>");

    const meta: ExperimentDefinition = experimentMeta;
    expect(meta.title).toBe("Sunflower Fader");
    expect(meta.surface).toBeUndefined();
    expect(meta.tags).toContain("ui-sdk");
  });
});

describe("colorAndCurves", () => {
  it("computes monotonic phased progress across 0..1 without endpoint plateaus", () => {
    const low = computePhasedProgress(-0.5);
    const early = computePhasedProgress(0.15);
    const mid = computePhasedProgress(0.55);
    const nearTop = computePhasedProgress(0.85);
    const high = computePhasedProgress(1.5);

    expect(low.raw).toBe(0);
    expect(high.raw).toBe(1);
    expect(early.warmth).toBeGreaterThan(0);
    expect(early.stemUncurl).toBeGreaterThan(0);
    expect(early.headLift).toBeGreaterThan(0);
    expect(mid.headLift).toBeGreaterThan(early.headLift);
    expect(mid.leafUnfurl).toBeGreaterThan(early.leafUnfurl);
    expect(nearTop.bloom).toBeLessThan(high.bloom);
    expect(nearTop.stemGrow).toBeLessThan(high.stemGrow);
    expect(high.bloom).toBe(1);
    expect(high.wildflower).toBe(1);
    expect(high.ecosystem).toBe(1);
  });

  it("transitions sky and petal palettes from overcast wilted tones to pastel summer", () => {
    const wilted = getPalette(computePhasedProgress(0));
    const blooming = getPalette(computePhasedProgress(1));

    expect(blooming.skyTop.b).toBeGreaterThan(wilted.skyTop.b);
    expect(blooming.petalOuter.g).toBeGreaterThan(wilted.petalOuter.g);
    expect(rgbToCss(wilted.paperBg)).toBe("rgb(245, 242, 234)");
  });
});

describe("botanyPhysics", () => {
  it("maps head center Y strictly linearly from HEAD_CARD_Y_MIN at 0% to HEAD_CARD_Y_MAX at 100%", () => {
    for (const percent of [0, 15, 35, 50, 75, 90, 100]) {
      const sim = createInitialSimState(percent);
      const expectedCardY = lerp(HEAD_CARD_Y_MIN, HEAD_CARD_Y_MAX, percent / 100);
      const actualCardY = sim.head.center.y - BLEED_Y;
      expect(actualCardY).toBeCloseTo(expectedCardY, 3);
    }
  });

  it("builds a drooping crook at 0% and lifts gaze smoothly to upright bloom at 100%", () => {
    const wilted = createInitialSimState(0);
    const mid = createInitialSimState(50);
    const blooming = createInitialSimState(100);

    expect(wilted.leaves).toHaveLength(10);
    expect(blooming.leaves).toHaveLength(10);
    expect(wilted.stem.length).toBeGreaterThan(4);
    expect(blooming.stem.length).toBeGreaterThan(4);

    const wiltedPos = getHeadNormalizedCardPos(wilted.head);
    const bloomPos = getHeadNormalizedCardPos(blooming.head);

    expect(wiltedPos.xPct).toBeGreaterThan(55);
    expect(wiltedPos.yPct).toBeCloseTo((HEAD_CARD_Y_MIN / CARD_HEIGHT) * 100, 1);
    expect(wilted.head.pitch).toBeLessThan(-1.2);
    expect(mid.head.pitch).toBeGreaterThan(wilted.head.pitch);
    expect(mid.head.pitch).toBeLessThan(blooming.head.pitch);

    expect(bloomPos.xPct).toBeCloseTo(50, 1);
    expect(bloomPos.yPct).toBeCloseTo((HEAD_CARD_Y_MAX / CARD_HEIGHT) * 100, 1);
    expect(Math.abs(blooming.head.pitch)).toBeLessThan(0.05);

    const rootNode = blooming.stem[0];
    expect(rootNode).toBeDefined();
    expect(rootNode?.x).toBeGreaterThan(BLEED_X);
    expect(rootNode?.x).toBeLessThan(BLEED_X + CARD_WIDTH);
    expect(rootNode?.y).toBeGreaterThanOrEqual(BLEED_Y + CARD_HEIGHT - 6);
  });

  it("keeps boilStep at 0, converges smoothly under stepSimState, and handles large dt safely", () => {
    const sim = createInitialSimState(10);

    for (let i = 0; i < 90; i++) {
      stepSimState(sim, 1 / 60, {
        targetValue: 90,
        dragging: false,
        hoverHead: false,
        pointerCanvas: null,
        reducedMotion: false,
      });
      expect(sim.boilStep).toBe(0);
    }

    expect(sim.displayValue).toBeGreaterThan(88);
    expect(sim.gust).toBe(0);

    stepSimState(sim, 10, {
      targetValue: 50,
      dragging: false,
      hoverHead: true,
      pointerCanvas: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 3 },
      reducedMotion: true,
    });

    expect(Number.isFinite(sim.displayValue)).toBe(true);
    expect(Number.isFinite(sim.head.center.x)).toBe(true);
    expect(Number.isFinite(sim.head.center.y)).toBe(true);
    expect(sim.boilStep).toBe(0);
  });

  it("detects head hits accurately via isPointOnHead", () => {
    const sim = createInitialSimState(68);
    expect(isPointOnHead(sim.head.center.x, sim.head.center.y, sim.head)).toBe(true);
    expect(isPointOnHead(0, 0, sim.head)).toBe(false);
    expect(isPointOnHead(CANVAS_WIDTH, CANVAS_HEIGHT, sim.head)).toBe(false);
  });

  it("flies active insects smoothly off the card at full opacity when value drops below 80%", () => {
    const sim = createInitialSimState(95);

    // Advance until the first insect enters the visible card
    let entered = false;
    for (let i = 0; i < 300; i++) {
      stepSimState(sim, 1 / 60, {
        targetValue: 95,
        dragging: false,
        hoverHead: false,
        pointerCanvas: null,
        reducedMotion: false,
      });
      if (
        sim.insect.active &&
        sim.insect.x > BLEED_X + 20 &&
        sim.insect.x < BLEED_X + CARD_WIDTH - 20
      ) {
        entered = true;
        expect(sim.insect.opacity).toBe(1);
        break;
      }
    }
    expect(entered).toBe(true);

    // Drop sharply below 80%: insect must NOT fade out in place; it must fly out past the card edge
    let lastActiveX = sim.insect.x;
    let lastActiveY = sim.insect.y;
    let sawStillActiveAfterDrop = false;
    for (let i = 0; i < 240; i++) {
      stepSimState(sim, 1 / 60, {
        targetValue: 20,
        dragging: false,
        hoverHead: false,
        pointerCanvas: null,
        reducedMotion: false,
      });
      if (sim.insect.active) {
        sawStillActiveAfterDrop = true;
        expect(sim.insect.opacity).toBe(1);
        lastActiveX = sim.insect.x;
        lastActiveY = sim.insect.y;
      } else {
        break;
      }
    }

    expect(sawStillActiveAfterDrop).toBe(true);
    expect(sim.insect.active).toBe(false);
    const exitedPastEdge =
      lastActiveX < BLEED_X - 20 ||
      lastActiveX > BLEED_X + CARD_WIDTH + 20 ||
      lastActiveY < BLEED_Y - 20;
    expect(exitedPastEdge).toBe(true);
  });

  it("faces straight down into the ground at low values without sideways yaw", () => {
    const at0 = createInitialSimState(0);
    const at10 = createInitialSimState(10);
    expect(at0.head.pitch).toBeLessThanOrEqual(-1.54);
    expect(Math.abs(at0.head.yaw)).toBeLessThan(0.01);
    expect(at10.head.pitch).toBeLessThanOrEqual(-1.48);
  });

  it("keeps grass and leaves calm without phase jumps when scrubbing after long uptime", () => {
    const sim = createInitialSimState(0);
    sim.time = 240;

    stepSimState(sim, 1 / 60, {
      targetValue: 0,
      dragging: true,
      hoverHead: false,
      pointerCanvas: null,
      reducedMotion: false,
    });
    let prevBend = sim.grass[0]?.bend ?? 0;
    let maxStepDelta = 0;

    for (let i = 1; i <= 30; i++) {
      stepSimState(sim, 1 / 60, {
        targetValue: (i / 30) * 100,
        dragging: true,
        hoverHead: false,
        pointerCanvas: null,
        reducedMotion: false,
      });
      const currBend = sim.grass[0]?.bend ?? 0;
      maxStepDelta = Math.max(maxStepDelta, Math.abs(currBend - prevBend));
      prevBend = currBend;
    }

    expect(maxStepDelta).toBeLessThan(0.025);
  });

  it("stretches subtly past 100% and 0% during overdrag and relaxes back on release", () => {
    const topSim = createInitialSimState(100);
    const topRestY = BLEED_Y + HEAD_CARD_Y_MAX;
    for (let i = 0; i < 30; i++) {
      stepSimState(topSim, 1 / 60, {
        targetValue: 100,
        dragging: true,
        hoverHead: false,
        pointerCanvas: { x: BLEED_X + CARD_WIDTH * 0.5, y: topRestY - 120 },
        reducedMotion: false,
      });
    }
    const pulledUpDelta = topRestY - topSim.head.center.y;
    expect(pulledUpDelta).toBeGreaterThan(4);
    expect(pulledUpDelta).toBeLessThan(14);

    for (let i = 0; i < 45; i++) {
      stepSimState(topSim, 1 / 60, {
        targetValue: 100,
        dragging: false,
        hoverHead: false,
        pointerCanvas: null,
        reducedMotion: false,
      });
    }
    expect(Math.abs(topSim.head.center.y - topRestY)).toBeLessThan(2);

    const botSim = createInitialSimState(0);
    const botRestY = BLEED_Y + HEAD_CARD_Y_MIN;
    for (let i = 0; i < 30; i++) {
      stepSimState(botSim, 1 / 60, {
        targetValue: 0,
        dragging: true,
        hoverHead: false,
        pointerCanvas: { x: BLEED_X + CARD_WIDTH * 0.64, y: botRestY + 120 },
        reducedMotion: false,
      });
    }
    const pulledDownDelta = botSim.head.center.y - botRestY;
    expect(pulledDownDelta).toBeGreaterThan(4);
    expect(pulledDownDelta).toBeLessThan(13);
  });

  it("triggers upward stretch even on off-center head grabs and sways left/right while dragging", () => {
    // Off-center grab 34px below head center at 100%, then pull upward 50px
    const topSim = createInitialSimState(100);
    const topRestY = BLEED_Y + HEAD_CARD_Y_MAX;
    const centerX = BLEED_X + CARD_WIDTH * 0.5;
    stepSimState(topSim, 1 / 60, {
      targetValue: 100,
      dragging: true,
      hoverHead: true,
      pointerCanvas: { x: centerX, y: topRestY + 34 },
      reducedMotion: false,
    });
    for (let i = 0; i < 25; i++) {
      stepSimState(topSim, 1 / 60, {
        targetValue: 100,
        dragging: true,
        hoverHead: true,
        pointerCanvas: { x: centerX, y: topRestY - 16 },
        reducedMotion: false,
      });
    }
    expect(topRestY - topSim.head.center.y).toBeGreaterThan(3);

    // Mid-range horizontal follow while dragging right & left
    const midSim = createInitialSimState(55);
    const baseHeadX = midSim.head.center.x;
    const baseHeadY = midSim.head.center.y;
    stepSimState(midSim, 1 / 60, {
      targetValue: 55,
      dragging: true,
      hoverHead: true,
      pointerCanvas: { x: baseHeadX, y: baseHeadY },
      reducedMotion: false,
    });
    for (let i = 0; i < 30; i++) {
      stepSimState(midSim, 1 / 60, {
        targetValue: 55,
        dragging: true,
        hoverHead: false,
        pointerCanvas: { x: baseHeadX + 70, y: baseHeadY },
        reducedMotion: false,
      });
    }
    expect(midSim.head.center.x - baseHeadX).toBeGreaterThan(4);

    for (let i = 0; i < 30; i++) {
      stepSimState(midSim, 1 / 60, {
        targetValue: 55,
        dragging: true,
        hoverHead: false,
        pointerCanvas: { x: baseHeadX - 70, y: baseHeadY },
        reducedMotion: false,
      });
    }
    expect(baseHeadX - midSim.head.center.x).toBeGreaterThan(4);
  });

  it("uses individualized non-linear curves per leaf while converging strictly at 0% and 100%", () => {
    const at0 = createInitialSimState(0);
    const at50 = createInitialSimState(50);
    const at100 = createInitialSimState(100);

    for (let i = 0; i < 10; i++) {
      expect(at0.leaves[i]?.turgor).toBe(0);
      expect(at0.leaves[i]?.curl).toBeCloseTo(0.92, 4);
      expect(at100.leaves[i]?.turgor).toBe(1);
      expect(at100.leaves[i]?.curl).toBeCloseTo(0.06, 4);
    }

    const midTurgors = at50.leaves.map((l) => l.turgor);
    const turgorSpread = Math.max(...midTurgors) - Math.min(...midTurgors);
    expect(turgorSpread).toBeGreaterThan(0.25);

    const midNormWidths = at50.leaves.map((l, idx) => {
      const w0 = at0.leaves[idx]?.width ?? 1;
      const w1 = at100.leaves[idx]?.width ?? 2;
      return (l.width - w0) / (w1 - w0);
    });
    const widthSpread = Math.max(...midNormWidths) - Math.min(...midNormWidths);
    expect(widthSpread).toBeGreaterThan(0.3);
  });

  it("bends smoothly without compressing and re-stretching past the midpoint", () => {
    const samplePercents = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];
    const lengths: number[] = [];
    const apexYs: number[] = [];
    const rootXs: number[] = [];

    for (const percent of samplePercents) {
      const sim = createInitialSimState(percent);
      let arcLen = 0;
      let minY = Number.POSITIVE_INFINITY;
      for (let i = 0; i < sim.stem.length; i++) {
        const node = sim.stem[i];
        if (!node) continue;
        if (node.y < minY) minY = node.y;
        if (i > 0) {
          const prev = sim.stem[i - 1];
          if (prev) {
            arcLen += Math.hypot(node.x - prev.x, node.y - prev.y);
          }
        }
      }
      lengths.push(arcLen);
      apexYs.push(minY);
      rootXs.push(sim.stem[0]?.x ?? 0);

      // Tip of stem must always stay attached to head.neck
      const tip = sim.stem[sim.stem.length - 1];
      expect(tip).toBeDefined();
      expect(tip?.x ?? 0).toBeCloseTo(sim.head.neck.x, 2);
      expect(tip?.y ?? 0).toBeCloseTo(sim.head.neck.y, 2);
    }

    // Stem length must be monotonically non-increasing as value drops (never re-stretching downward)
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i] ?? 0).toBeLessThanOrEqual((lengths[i - 1] ?? 0) + 0.5);
    }

    // Lower half (50% down to 0%) holds constant arc length as the crook deepens
    const lowerHalf = lengths.slice(5);
    expect(Math.max(...lowerHalf) - Math.min(...lowerHalf)).toBeLessThan(1.5);

    // Stem apex lowers smoothly and monotonically from 100% down to 0%
    for (let i = 1; i < apexYs.length; i++) {
      expect(apexYs[i] ?? 0).toBeGreaterThanOrEqual((apexYs[i - 1] ?? 0) - 0.1);
    }

    // Root stays planted in one spot in the soil
    const rootSpread = Math.max(...rootXs) - Math.min(...rootXs);
    expect(rootSpread).toBeLessThan(0.01);

    // Smooth entry near 100%: 100% -> 99% step must not spike sharply relative to 98% -> 97%
    const at100 = createInitialSimState(100);
    const at99 = createInitialSimState(99);
    const at98 = createInitialSimState(98);
    const at97 = createInitialSimState(97);
    const tipAngle = (s: ReturnType<typeof createInitialSimState>) => {
      const tip = s.stem[s.stem.length - 1];
      return tip ? Math.atan2(tip.tx, -tip.ty) : 0;
    };
    const stepTop = Math.abs(tipAngle(at99) - tipAngle(at100));
    const stepNext = Math.abs(tipAngle(at97) - tipAngle(at98));
    expect(stepTop).toBeLessThan(stepNext * 1.15);
    expect(Math.abs(at99.head.center.x - at100.head.center.x)).toBeLessThan(1.6);
  });

  it("stays smooth without stem jitter when dragging up and to the left at 100%", () => {
    const sim = createInitialSimState(100);
    let prevMidX = sim.stem[24]?.x ?? 0;
    let maxSteadyJump = 0;

    for (let i = 0; i < 90; i++) {
      stepSimState(sim, 1 / 60, {
        targetValue: 100,
        dragging: true,
        hoverHead: false,
        pointerCanvas: { x: BLEED_X + 10, y: BLEED_Y + 20 },
        reducedMotion: false,
      });
      const midX = sim.stem[24]?.x ?? 0;
      if (i >= 20) {
        maxSteadyJump = Math.max(maxSteadyJump, Math.abs(midX - prevMidX));
      }
      prevMidX = midX;
    }

    expect(maxSteadyJump).toBeLessThan(0.25);
  });
});

describe("renderSunflowerFrame mobile GPU budget", () => {
  it("avoids per-frame shadowBlur, multiply compositing, and gradient/draw-call explosions", () => {
    const prevDocument = globalThis.document;
    const prevPath2D = globalThis.Path2D;

    interface Counters {
      fills: number;
      strokes: number;
      gradients: number;
      shadowBlurDraws: number;
      multiplyDraws: number;
      drawImages: number;
      clips: number;
    }

    const createMockCanvas = (counters?: Counters) => {
      const canvas = {
        width: CANVAS_WIDTH * 2,
        height: CANVAS_HEIGHT * 2,
        getContext: () => ctx,
      };
      const stateStack: { shadowBlur: number; globalCompositeOperation: string }[] = [];
      const ctx = {
        canvas,
        shadowBlur: 0,
        shadowColor: "",
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        globalCompositeOperation: "source-over",
        globalAlpha: 1,
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        save() {
          stateStack.push({
            shadowBlur: this.shadowBlur,
            globalCompositeOperation: this.globalCompositeOperation,
          });
        },
        restore() {
          const prev = stateStack.pop();
          if (prev) {
            this.shadowBlur = prev.shadowBlur;
            this.globalCompositeOperation = prev.globalCompositeOperation;
          }
        },
        setTransform() {},
        transform() {},
        translate() {},
        rotate() {},
        scale() {},
        clearRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        bezierCurveTo() {},
        arc() {},
        ellipse() {},
        rect() {},
        clip() {
          if (counters) counters.clips++;
        },
        fill() {
          if (counters) {
            counters.fills++;
            if (this.shadowBlur > 0) counters.shadowBlurDraws++;
            if (this.globalCompositeOperation === "multiply") counters.multiplyDraws++;
          }
        },
        fillRect() {
          if (counters) {
            counters.fills++;
            if (this.shadowBlur > 0) counters.shadowBlurDraws++;
            if (this.globalCompositeOperation === "multiply") counters.multiplyDraws++;
          }
        },
        stroke() {
          if (counters) {
            counters.strokes++;
            if (this.shadowBlur > 0) counters.shadowBlurDraws++;
            if (this.globalCompositeOperation === "multiply") counters.multiplyDraws++;
          }
        },
        drawImage() {
          if (counters) {
            counters.drawImages++;
            if (this.shadowBlur > 0) counters.shadowBlurDraws++;
            if (this.globalCompositeOperation === "multiply") counters.multiplyDraws++;
          }
        },
        createLinearGradient() {
          if (counters) counters.gradients++;
          return { addColorStop() {} };
        },
        createRadialGradient() {
          if (counters) counters.gradients++;
          return { addColorStop() {} };
        },
        createPattern() {
          return {};
        },
        createImageData(w: number, h: number) {
          return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
        },
        getImageData(_x: number, _y: number, w: number, h: number) {
          return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
        },
        putImageData() {},
      };
      return { canvas, ctx };
    };

    class MockPath2D {
      moveTo() {}
      lineTo() {}
      quadraticCurveTo() {}
      bezierCurveTo() {}
      arc() {}
      ellipse() {}
      rect() {}
      closePath() {}
      addPath() {}
    }

    try {
      (globalThis as unknown as { Path2D: unknown }).Path2D = MockPath2D;
      (globalThis as unknown as { document: unknown }).document = {
        createElement: () => createMockCanvas().canvas,
      };

      const counters: Counters = {
        fills: 0,
        strokes: 0,
        gradients: 0,
        shadowBlurDraws: 0,
        multiplyDraws: 0,
        drawImages: 0,
        clips: 0,
      };
      const main = createMockCanvas(counters);
      const sim = createInitialSimState(75);

      // Warm up one-time sprite/texture caches on frame 0
      renderSunflowerFrame(main.ctx as unknown as CanvasRenderingContext2D, sim, 2);

      // Measure steady-state idle frame
      counters.fills = 0;
      counters.strokes = 0;
      counters.gradients = 0;
      counters.shadowBlurDraws = 0;
      counters.multiplyDraws = 0;
      counters.drawImages = 0;
      counters.clips = 0;

      stepSimState(sim, 1 / 60, {
        targetValue: 75,
        dragging: false,
        hoverHead: false,
        pointerCanvas: null,
        reducedMotion: false,
      });
      renderSunflowerFrame(main.ctx as unknown as CanvasRenderingContext2D, sim, 2);

      expect(counters.shadowBlurDraws).toBe(0);
      expect(counters.multiplyDraws).toBe(0);
      expect(counters.gradients).toBeLessThan(25);
      expect(counters.fills + counters.strokes).toBeLessThan(120);
      // Only card/bottom/stem/outside-shadow clips on idle (0 per-leaf complex clips)
      expect(counters.clips).toBeLessThanOrEqual(6);
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDocument;
      (globalThis as unknown as { Path2D: unknown }).Path2D = prevPath2D;
    }
  });
});
