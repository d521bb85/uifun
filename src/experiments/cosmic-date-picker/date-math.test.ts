import { describe, expect, it } from "vitest";
import {
  clampDate,
  daysInMonth,
  formatIsoDate,
  parseIsoDate,
  stepDay,
  stepMonth,
  stepYear,
} from "./date-math";

describe("cosmic date math", () => {
  it("parses and formats ISO dates", () => {
    expect(parseIsoDate("1995-02-16")).toEqual({ year: 1995, month: 2, day: 16 });
    expect(formatIsoDate({ year: 1995, month: 2, day: 16 })).toBe("1995-02-16");
    expect(parseIsoDate("1995-02-30")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it("handles leap years accurately", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("wraps day steps strictly within the current month without changing month or year", () => {
    expect(stepDay({ year: 1995, month: 2, day: 28 }, 1)).toEqual({
      year: 1995,
      month: 2,
      day: 1,
    });
    expect(stepDay({ year: 1995, month: 12, day: 31 }, 1)).toEqual({
      year: 1995,
      month: 12,
      day: 1,
    });
    expect(stepDay({ year: 1995, month: 2, day: 1 }, -1)).toEqual({
      year: 1995,
      month: 2,
      day: 28,
    });
  });

  it("wraps month steps within 1..12 without changing year and clamps day", () => {
    expect(stepMonth({ year: 2024, month: 1, day: 31 }, 1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(stepMonth({ year: 1995, month: 12, day: 15 }, 1)).toEqual({
      year: 1995,
      month: 1,
      day: 15,
    });
    expect(stepMonth({ year: 1995, month: 1, day: 15 }, -1)).toEqual({
      year: 1995,
      month: 12,
      day: 15,
    });
  });

  it("clamps year steps within the asymmetric 150-year horizon", () => {
    expect(stepYear({ year: 2024, month: 2, day: 29 }, 1, 1906, 2056)).toEqual({
      year: 2025,
      month: 2,
      day: 28,
    });
    expect(stepYear({ year: 1910, month: 6, day: 10 }, -20, 1906, 2056)).toEqual({
      year: 1906,
      month: 6,
      day: 10,
    });
    expect(clampDate({ year: 2100, month: 5, day: 1 }, 1906, 2056)).toEqual({
      year: 2056,
      month: 5,
      day: 1,
    });
  });
});
