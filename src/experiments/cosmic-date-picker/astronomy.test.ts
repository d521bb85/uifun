import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  addDateSegment,
  computeCosmicState,
  computeLunarDirectionEcliptic,
  computeLunarSunDirectionObserver,
  computeSunDirectionEcliptic,
  daysInMonth,
  formatIsoDate,
  galacticToEclipticDirection,
  geographicToEclipticNormal,
  parseIsoDate,
  toJulianDay,
} from "./astronomy";
import { BRIGHT_STARS, bvToRgb } from "./starCatalog";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

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
    // Nov 2026 Full Moon is near perigee (closer, larger apparent scale & stronger king tide)
    // while Nov 2026 New Moon is near apogee
    expect(fullMoon.lunar.apparentScale).toBeGreaterThan(newMoon.lunar.apparentScale);
    expect(fullMoon.tidal.springNeapIndex).toBeGreaterThan(newMoon.tidal.springNeapIndex);
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

  it("wraps day and month cyclically without mutating parent date segments", () => {
    expect(addDateSegment("2026-12-31", "day", 1)).toBe("2026-12-01");
    expect(addDateSegment("2026-01-01", "day", -1)).toBe("2026-01-31");
    expect(addDateSegment("2024-02-01", "day", -1)).toBe("2024-02-29");
    expect(addDateSegment("2026-02-28", "day", 1)).toBe("2026-02-01");
    expect(addDateSegment("2026-12-15", "month", 1)).toBe("2026-01-15");
    expect(addDateSegment("2026-01-15", "month", -1)).toBe("2026-12-15");
    expect(addDateSegment("2026-02-16", "month", 12)).toBe("2026-02-16");
    expect(addDateSegment("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(addDateSegment("2024-02-29", "year", 1)).toBe("2025-02-28");
    expect(parseIsoDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseIsoDate("2025-02-29")).toBeNull();
    expect(formatIsoDate(2026, 11, 24)).toBe("2026-11-24");
  });

  it("aligns Earth's 3D subsolar point and polar seasons accurately with the heliocentric Sun direction", () => {
    const seasonalDates = ["2026-03-20", "2026-06-21", "2026-09-23", "2026-12-21"];
    for (const iso of seasonalDates) {
      const { solar } = computeCosmicState(iso);
      const sunDir = computeSunDirectionEcliptic(solar);
      const subsolarNormal = geographicToEclipticNormal(
        solar.subsolarLatRad,
        solar.subsolarLonRad,
        solar.obliquityRad,
        solar.gmstRad,
      );
      expect(dot3(subsolarNormal, sunDir)).toBeGreaterThan(0.9999);
    }

    const june = computeCosmicState("2026-06-21").solar;
    const dec = computeCosmicState("2026-12-21").solar;
    const march = computeCosmicState("2026-03-20").solar;

    const northPoleJune = geographicToEclipticNormal(
      Math.PI / 2,
      0,
      june.obliquityRad,
      june.gmstRad,
    );
    const southPoleJune = geographicToEclipticNormal(
      -Math.PI / 2,
      0,
      june.obliquityRad,
      june.gmstRad,
    );
    const northPoleDec = geographicToEclipticNormal(Math.PI / 2, 0, dec.obliquityRad, dec.gmstRad);
    const northPoleMarch = geographicToEclipticNormal(
      Math.PI / 2,
      0,
      march.obliquityRad,
      march.gmstRad,
    );

    expect(dot3(northPoleJune, computeSunDirectionEcliptic(june))).toBeCloseTo(
      Math.sin(23.44 * DEG2RAD),
      2,
    );
    expect(dot3(southPoleJune, computeSunDirectionEcliptic(june))).toBeCloseTo(
      -Math.sin(23.44 * DEG2RAD),
      2,
    );
    expect(dot3(northPoleDec, computeSunDirectionEcliptic(dec))).toBeCloseTo(
      -Math.sin(23.44 * DEG2RAD),
      2,
    );
    expect(Math.abs(dot3(northPoleMarch, computeSunDirectionEcliptic(march)))).toBeLessThan(0.015);

    // Arctic Circle (~66.56°N) experiences midnight sun grazing the horizon at June solstice
    const arcticMidnightJune = geographicToEclipticNormal(
      66.56 * DEG2RAD,
      june.subsolarLonRad + Math.PI,
      june.obliquityRad,
      june.gmstRad,
    );
    expect(Math.abs(dot3(arcticMidnightJune, computeSunDirectionEcliptic(june)))).toBeLessThan(
      0.01,
    );
  });

  it("places the 3D geocentric Moon direction accurately relative to the Sun across lunar phases", () => {
    const newMoon = computeCosmicState("2026-11-09");
    const firstQuarter = computeCosmicState("2026-11-17");
    const fullMoon = computeCosmicState("2026-11-24");

    const newMoonDot = dot3(
      computeLunarDirectionEcliptic(newMoon.lunar),
      computeSunDirectionEcliptic(newMoon.solar),
    );
    const quarterDot = dot3(
      computeLunarDirectionEcliptic(firstQuarter.lunar),
      computeSunDirectionEcliptic(firstQuarter.solar),
    );
    const fullMoonDot = dot3(
      computeLunarDirectionEcliptic(fullMoon.lunar),
      computeSunDirectionEcliptic(fullMoon.solar),
    );

    expect(newMoonDot).toBeGreaterThan(0.95);
    expect(Math.abs(quarterDot)).toBeLessThan(0.18);
    expect(fullMoonDot).toBeLessThan(-0.95);
  });

  it("computes IAU optical lunar libration and matches 3D orbital & day sub-Earth coordinates", () => {
    // 2026-11-24: Moon is ~5° north of ecliptic -> Earth sees ~6.5° south (including Cassini 1.54° tilt)
    // 2026-11-09: Moon is ~5° south of ecliptic -> Earth sees ~6.5° north
    for (const iso of ["2026-11-09", "2026-11-17", "2026-11-24"]) {
      const { lunar } = computeCosmicState(iso);
      const moonPos = new THREE.Vector3(...computeLunarDirectionEcliptic(lunar));
      const dirToEarth = moonPos.clone().negate().normalize();

      // 3D Orbital Moon transform (matching CosmicScene.ts)
      const orbMesh = new THREE.Mesh();
      orbMesh.rotation.order = "YXZ";
      orbMesh.rotation.set(
        0,
        lunar.longitudeRad + Math.PI - lunar.librationLonRad,
        -(lunar.latitudeRad + lunar.librationLatRad),
      );
      orbMesh.updateMatrixWorld(true);
      const earthInOrb = dirToEarth.clone().applyQuaternion(orbMesh.quaternion.clone().invert());
      const orbSubLat = Math.asin(Math.max(-1, Math.min(1, earthInOrb.y)));
      const orbSubLon = Math.atan2(-earthInOrb.z, earthInOrb.x);

      // Day Mode Moon transform (matching CosmicScene.ts, observer along +Z)
      const dayMesh = new THREE.Mesh();
      dayMesh.rotation.set(lunar.librationLatRad, -Math.PI * 0.5 - lunar.librationLonRad, 0);
      dayMesh.updateMatrixWorld(true);
      const obsInDay = new THREE.Vector3(0, 0, 1).applyQuaternion(
        dayMesh.quaternion.clone().invert(),
      );
      const daySubLat = Math.asin(Math.max(-1, Math.min(1, obsInDay.y)));
      const daySubLon = Math.atan2(-obsInDay.z, obsInDay.x);

      expect(orbSubLat * RAD2DEG).toBeCloseTo(lunar.librationLatRad * RAD2DEG, 1);
      expect(orbSubLon * RAD2DEG).toBeCloseTo(lunar.librationLonRad * RAD2DEG, 1);
      expect(daySubLat * RAD2DEG).toBeCloseTo(lunar.librationLatRad * RAD2DEG, 2);
      expect(daySubLon * RAD2DEG).toBeCloseTo(lunar.librationLonRad * RAD2DEG, 2);
    }

    const northMoon = computeCosmicState("2026-11-24").lunar;
    const southMoon = computeCosmicState("2026-11-09").lunar;
    expect(northMoon.latitudeRad * RAD2DEG).toBeGreaterThan(4.5);
    expect(northMoon.librationLatRad * RAD2DEG).toBeLessThan(-6.0);
    expect(southMoon.latitudeRad * RAD2DEG).toBeLessThan(-4.5);
    expect(southMoon.librationLatRad * RAD2DEG).toBeGreaterThan(6.0);
  });

  it("projects the Day-mode lunar Sun vector accurately across elongation and ecliptic latitude", () => {
    const beta = 5 * DEG2RAD;
    const newMoon = computeLunarSunDirectionObserver(0, beta);
    const firstQ = computeLunarSunDirectionObserver(Math.PI / 2, beta);
    const fullMoon = computeLunarSunDirectionObserver(Math.PI, beta);
    const lastQ = computeLunarSunDirectionObserver((3 * Math.PI) / 2, beta);

    // Always unit length
    for (const v of [newMoon, firstQ, fullMoon, lastQ]) {
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6);
    }

    // Moon 5° north of Sun at New Moon -> Sun sits below (-Y) behind the Moon (-Z)
    expect(newMoon[0]).toBeCloseTo(0, 6);
    expect(newMoon[1]).toBeCloseTo(-Math.sin(beta), 6);
    expect(newMoon[2]).toBeCloseTo(-Math.cos(beta), 6);

    // At Quarters, Sun lies purely right (+X, waxing) or left (-X, waning) with zero vertical tilt
    expect(firstQ[0]).toBeCloseTo(1, 6);
    expect(Math.abs(firstQ[1])).toBeLessThan(1e-6);
    expect(lastQ[0]).toBeCloseTo(-1, 6);
    expect(Math.abs(lastQ[1])).toBeLessThan(1e-6);

    // Moon 5° north of antisolar point at Full Moon -> Sun illuminates slightly from +Y
    expect(fullMoon[1]).toBeCloseTo(Math.sin(beta), 6);
    expect(fullMoon[2]).toBeCloseTo(Math.cos(beta), 6);
  });

  it("aligns the Galactic-to-ecliptic transform with real J2000 Galactic landmarks", () => {
    const j2000Obl = 23.43929111 * DEG2RAD;
    const eqToEcl = (raDeg: number, decDeg: number): [number, number, number] => {
      const ra = raDeg * DEG2RAD;
      const dec = decDeg * DEG2RAD;
      const xEq = Math.cos(dec) * Math.cos(ra);
      const yEq = Math.sin(dec);
      const zEq = -Math.cos(dec) * Math.sin(ra);
      return [
        xEq,
        yEq * Math.cos(j2000Obl) + zEq * Math.sin(j2000Obl),
        -yEq * Math.sin(j2000Obl) + zEq * Math.cos(j2000Obl),
      ];
    };

    // Galactic Center (Sgr A*), North Galactic Pole, Cygnus (l=90°), Anticenter (l=180°)
    expect(dot3(galacticToEclipticDirection(0, 0), eqToEcl(266.405, -28.936))).toBeGreaterThan(
      0.9999,
    );
    expect(
      dot3(galacticToEclipticDirection(0, Math.PI / 2), eqToEcl(192.8595, 27.1283)),
    ).toBeGreaterThan(0.9999);
    expect(
      dot3(galacticToEclipticDirection(Math.PI / 2, 0), eqToEcl(318.004, 48.33)),
    ).toBeGreaterThan(0.9999);
    expect(dot3(galacticToEclipticDirection(Math.PI, 0), eqToEcl(86.405, 28.936))).toBeGreaterThan(
      0.9999,
    );
  });

  it("keeps bright star catalog free of duplicates and B-V color mapping continuous", () => {
    for (let i = 0; i < BRIGHT_STARS.length; i += 1) {
      for (let j = i + 1; j < BRIGHT_STARS.length; j += 1) {
        const a = BRIGHT_STARS[i];
        const b = BRIGHT_STARS[j];
        if (!a || !b) continue;
        const ra1 = a.raHours * 15 * DEG2RAD;
        const dec1 = a.decDeg * DEG2RAD;
        const ra2 = b.raHours * 15 * DEG2RAD;
        const dec2 = b.decDeg * DEG2RAD;
        const cosSep =
          Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
        const sepDeg = Math.acos(Math.max(-1, Math.min(1, cosSep))) * RAD2DEG;
        expect(sepDeg).toBeGreaterThan(0.5);
      }
    }

    const neg = bvToRgb(-0.0001);
    const pos = bvToRgb(0.0001);
    expect(Math.abs(neg[0] - pos[0])).toBeLessThan(0.002);
    expect(Math.abs(neg[1] - pos[1])).toBeLessThan(0.002);
    expect(Math.abs(neg[2] - pos[2])).toBeLessThan(0.002);
  });

  it("handles proleptic Gregorian daysInMonth accurately for low and century years", () => {
    expect(daysInMonth(1, 2)).toBe(28);
    expect(daysInMonth(4, 2)).toBe(29);
    expect(daysInMonth(100, 2)).toBe(28);
    expect(daysInMonth(400, 2)).toBe(29);
  });
});
