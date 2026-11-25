import { describe, expect, it } from "vitest";
import * as shaders from "./shaders";

function stripGlslComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function countDelimiters(source: string, open: string, close: string): number {
  const code = stripGlslComments(source);
  let balance = 0;
  for (const ch of code) {
    if (ch === open) balance += 1;
    if (ch === close) balance -= 1;
    if (balance < 0) return balance;
  }
  return balance;
}

describe("GLSL shader safety & browser compatibility", () => {
  const entries = Object.entries(shaders);

  it("exports paired vertex and fragment shaders with valid structure", () => {
    expect(entries.length).toBeGreaterThanOrEqual(20);
    for (const [name, source] of entries) {
      expect(typeof source, name).toBe("string");
      expect(source, `${name} should define void main()`).toContain("void main()");
      expect(countDelimiters(source, "{", "}"), `${name} braces balanced`).toBe(0);
      expect(countDelimiters(source, "(", ")"), `${name} parens balanced`).toBe(0);

      if (name.endsWith("VertexShader")) {
        expect(source, `${name} should assign gl_Position`).toContain("gl_Position");
      }
      if (name.endsWith("FragmentShader")) {
        expect(source, `${name} should assign gl_FragColor`).toContain("gl_FragColor");
      }
    }
  });

  it("avoids pow(x, 2.0) and sin-based hashes that cause NaN or precision banding across GPUs", () => {
    for (const [name, source] of entries) {
      // GLSL ES pow(x, y) is undefined for x < 0 even when y == 2.0 (NaN on Safari/Metal & ANGLE)
      expect(source, `${name} must not call pow(..., 2.0)`).not.toMatch(/pow\([^;]+,\s*2\.0\)/);
      // Unguarded pow(1.0 - dot/ndv, ...) can produce NaN if dot(N, V) rounds to > 1.0
      expect(source, `${name} must guard pow(1.0 - ...)`).not.toMatch(/pow\(\s*1\.0\s*-/);
      // Classic sin(dot(p, ...)) * 43758.5453 hash loses precision on mobile GPUs
      expect(source, `${name} must use sin-free hash`).not.toContain("43758.5453");
    }
  });
});
