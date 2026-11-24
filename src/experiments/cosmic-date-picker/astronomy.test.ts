import { describe, expect, it } from "vitest";
import {
  addDateSegment,
  computeCosmicState,
  formatIsoDate,
  parseIsoDate,
  toJulianDay,
} from "./astronomy";

const RAD2DEG = 180 / Math.PI;

describe("cosmic astronomy engine", () => {
  it("computes exact J2000.0 Julian Day", () => {
    expect(toJulianDay(2000, 1, 1, 12)).toBeCloseTo(2451545.0, 6);
  });

  it("calculates accurate seasonal solar declination at solstices and equinoxes", () => {
    const marchEquinox = computeCosmicState("2026-03-20");
    const juneSolstice = computeCosmicState("2026-06-21");
    const septEquinox = computeCosmicState("2026-09-23");
    const decSolstice = computeCosmicState("2026-12-21");

    expect(Math.abs(marchEquinox.solar.sunDeclinationRad * RAD2DEG)).toBeLessThan(0.6);
    expect(juneSolstice.solar.sunDeclinationRad * RAD2DEG).toBeCloseTo(23.44, 1);
    expect(Math.abs(septEquinox.solar.sunDeclinationRad * RAD2DEG)).toBeLessThan(0.6);
    expect(decSolstice.solar.sunDeclinationRad * RAD2DEG).toBeCloseTo(-23.44, 1);
  });

  it("models Earth's eccentric orbit with perihelion in January and aphelion in July", () => {
    const perihelion = computeCosmicState("2026-01-03");
    const aphelion = computeCosmicState("2026-07-06");

    expect(perihelion.solar.earthSunDistanceAU).toBeCloseTo(0.9833, 3);
    expect(aphelion.solar.earthSunDistanceAU).toBeCloseTo(1.0167, 3);
    expect(perihelion.solar.earthSunDistanceAU).toBeLessThan(aphelion.solar.earthSunDistanceAU);
  });

  it("computes accurate lunar phases and spring vs neap tidal potentials", () => {
    const newMoon = computeCosmicState("2026-11-09");
    const firstQuarter = computeCosmicState("2026-11-17");
    const fullMoon = computeCosmicState("2026-11-24");

    expect(newMoon.lunar.illumination).toBeLessThan(0.05);
    expect(firstQuarter.lunar.illumination).toBeGreaterThan(0.4);
    expect(firstQuarter.lunar.illumination).toBeLessThan(0.6);
    expect(fullMoon.lunar.illumination).toBeGreaterThan(0.95);

    expect(newMoon.lunar.earthshine).toBeGreaterThan(fullMoon.lunar.earthshine);
    expect(fullMoon.tidal.springNeapIndex).toBeGreaterThan(firstQuarter.tidal.springNeapIndex);
    expect(newMoon.tidal.springNeapIndex).toBeGreaterThan(firstQuarter.tidal.springNeapIndex);
  });

  it("advances galactic epoch and axial precession monotonically across years", () => {
    const y1950 = computeCosmicState("1950-06-15");
    const y2000 = computeCosmicState("2000-06-15");
    const y2050 = computeCosmicState("2050-06-15");

    expect(y1950.galactic.epochYearsSinceJ2000).toBeLessThan(y2000.galactic.epochYearsSinceJ2000);
    expect(y2050.galactic.epochYearsSinceJ2000).toBeGreaterThan(
      y2000.galactic.epochYearsSinceJ2000,
    );
    expect(y2050.galactic.axialPrecessionRad).toBeGreaterThan(y1950.galactic.axialPrecessionRad);
    expect(y2050.galactic.solarDistanceBillionKm).toBeGreaterThan(
      y1950.galactic.solarDistanceBillionKm,
    );
  });

  it("rolls calendar boundaries accurately when scrubbing days, months, and years", () => {
    expect(addDateSegment("2026-12-31", "day", 1)).toBe("2027-01-01");
    expect(addDateSegment("2026-01-01", "day", -1)).toBe("2025-12-31");
    expect(addDateSegment("2026-12-15", "month", 1)).toBe("2027-01-15");
    expect(addDateSegment("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(addDateSegment("2024-02-29", "year", 1)).toBe("2025-02-28");
    expect(parseIsoDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseIsoDate("2025-02-29")).toBeNull();
    expect(formatIsoDate(2026, 11, 24)).toBe("2026-11-24");
  });
});
