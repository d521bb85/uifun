const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const AU_IN_KM = 149597870.7;
const MEAN_LUNAR_DISTANCE_KM = 384400;
export const SYNODIC_MONTH_DAYS = 29.530588853;
const GALACTIC_YEAR_YEARS = 230_000_000;
const J2000_JD = 2451545.0;

export interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

export interface SolarState {
  julianDay: number;
  julianCenturies: number;
  sunTrueLongitudeRad: number;
  sunApparentLongitudeRad: number;
  earthHeliocentricLongitudeRad: number;
  earthSunDistanceAU: number;
  obliquityRad: number;
  sunDeclinationRad: number;
  sunRightAscensionRad: number;
  gmstRad: number;
  subsolarLatRad: number;
  subsolarLonRad: number;
}

export interface LunarState {
  longitudeRad: number;
  latitudeRad: number;
  distanceKm: number;
  elongationRad: number;
  phaseAngleRad: number;
  illumination: number;
  synodicAgeDays: number;
  waxing: boolean;
  apparentScale: number;
  librationLonRad: number;
  librationLatRad: number;
  earthshine: number;
}

export interface TidalState {
  lunarPotential: number;
  solarPotential: number;
  combinedAmplitude: number;
  springNeapIndex: number;
  semiDiurnalPhaseRad: number;
  waterLevel: number;
  swellEnergy: number;
}

export interface GalacticState {
  epochYearsSinceJ2000: number;
  galacticOrbitAngleRad: number;
  axialPrecessionRad: number;
  solarDistanceBillionKm: number;
  solarApexLonRad: number;
  solarApexLatRad: number;
}

export interface CosmicState {
  isoDate: string;
  date: ParsedDate;
  solar: SolarState;
  lunar: LunarState;
  tidal: TidalState;
  galactic: GalacticState;
}

function mod360(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatIsoDate(year: number, month: number, day: number): string {
  const y = String(clamp(Math.trunc(year), 1, 9999)).padStart(4, "0");
  const m = String(clamp(Math.trunc(month), 1, 12)).padStart(2, "0");
  const d = String(clamp(Math.trunc(day), 1, daysInMonth(Number(y), Number(m)))).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): ParsedDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  return { year, month, day };
}

export function getTodayIsoDate(): string {
  const now = new Date();
  return formatIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDateSegment(
  iso: string,
  unit: "year" | "month" | "day",
  delta: number,
  minIso = "0001-01-01",
  maxIso = "9999-12-31",
): string {
  const parsed = parseIsoDate(iso);
  if (!parsed || delta === 0) return iso;

  let nextIso: string;
  if (unit === "year") {
    const nextYear = clamp(parsed.year + delta, 1, 9999);
    const maxDay = daysInMonth(nextYear, parsed.month);
    nextIso = formatIsoDate(nextYear, parsed.month, Math.min(parsed.day, maxDay));
  } else if (unit === "month") {
    const nextMonth = ((((parsed.month - 1 + delta) % 12) + 12) % 12) + 1;
    const maxDay = daysInMonth(parsed.year, nextMonth);
    nextIso = formatIsoDate(parsed.year, nextMonth, Math.min(parsed.day, maxDay));
  } else {
    const maxDay = daysInMonth(parsed.year, parsed.month);
    const nextDay = ((((parsed.day - 1 + delta) % maxDay) + maxDay) % maxDay) + 1;
    nextIso = formatIsoDate(parsed.year, parsed.month, nextDay);
  }

  if (nextIso < minIso) return minIso;
  if (nextIso > maxIso) return maxIso;
  return nextIso;
}

export function toJulianDay(year: number, month: number, day: number, utcHours = 12): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day +
    utcHours / 24 +
    b -
    1524.5
  );
}

export function computeSolarState(jd: number): SolarState {
  const t = (jd - J2000_JD) / 36525.0;
  const t2 = t * t;
  const t3 = t2 * t;

  const l0 = mod360(280.46646 + 36000.76983 * t + 0.0003032 * t2);
  const mDeg = mod360(357.52911 + 35999.05029 * t - 0.0001537 * t2);
  const mRad = mDeg * DEG2RAD;

  const e = 0.016708634 - 0.000042037 * t - 0.0000001267 * t2;
  const cDeg =
    (1.914602 - 0.004817 * t - 0.000014 * t2) * Math.sin(mRad) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * mRad) +
    0.000289 * Math.sin(3 * mRad);

  const sunTrueLonDeg = mod360(l0 + cDeg);
  const trueAnomalyRad = (mDeg + cDeg) * DEG2RAD;
  const earthSunDistanceAU = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnomalyRad));

  const omegaRad = (125.04 - 1934.136 * t) * DEG2RAD;
  const sunAppLonDeg = mod360(sunTrueLonDeg - 0.00569 - 0.00478 * Math.sin(omegaRad));
  const sunAppLonRad = sunAppLonDeg * DEG2RAD;

  const obliquityDeg =
    23.43929111 - (46.815 * t + 0.00059 * t2 - 0.001813 * t3) / 3600 + 0.00256 * Math.cos(omegaRad);
  const obliquityRad = obliquityDeg * DEG2RAD;

  const sunDeclinationRad = Math.asin(Math.sin(obliquityRad) * Math.sin(sunAppLonRad));
  const sunRightAscensionRad = Math.atan2(
    Math.cos(obliquityRad) * Math.sin(sunAppLonRad),
    Math.cos(sunAppLonRad),
  );

  const gmstDeg = mod360(
    280.46061837 + 360.98564736629 * (jd - J2000_JD) + 0.000387933 * t2 - t3 / 38710000,
  );
  const gmstRad = gmstDeg * DEG2RAD;

  const earthHeliocentricLongitudeRad = mod360(sunTrueLonDeg + 180) * DEG2RAD;
  const subsolarLonRad = ((sunRightAscensionRad - gmstRad + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

  return {
    julianDay: jd,
    julianCenturies: t,
    sunTrueLongitudeRad: sunTrueLonDeg * DEG2RAD,
    sunApparentLongitudeRad: sunAppLonRad,
    earthHeliocentricLongitudeRad,
    earthSunDistanceAU,
    obliquityRad,
    sunDeclinationRad,
    sunRightAscensionRad,
    gmstRad,
    subsolarLatRad: sunDeclinationRad,
    subsolarLonRad,
  };
}

// Meeus Ch. 47 periodic terms: [D, M, M', F, sigmaL (1e-6 deg), sigmaR (meters)]
const LUNAR_LR_TERMS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
];

// Meeus Table 47.B latitude terms: [D, M, M', F, sigmaB (1e-6 deg)]
const LUNAR_B_TERMS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
];

export function computeLunarState(jd: number, solar: SolarState): LunarState {
  const t = (jd - J2000_JD) / 36525.0;
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;

  const lp = mod360(
    218.3164477 + 481267.88123421 * t - 0.0015786 * t2 + t3 / 538841 - t4 / 65194000,
  );
  const d = mod360(
    297.8501921 + 445267.1114034 * t - 0.0018819 * t2 + t3 / 545868 - t4 / 113065000,
  );
  const m = mod360(357.5291092 + 35999.0502909 * t - 0.0001536 * t2 + t3 / 24490000);
  const mp = mod360(134.9633964 + 477198.8675055 * t + 0.0087414 * t2 + t3 / 69699 - t4 / 14712000);
  const f = mod360(93.272095 + 483202.0175233 * t - 0.0036539 * t2 - t3 / 3526000 + t4 / 863310000);

  const e = 1 - 0.002516 * t - 0.0000074 * t2;
  const e2 = e * e;

  let sumL = 0;
  let sumR = 0;
  for (const [cd, cm, cmp, cf, sl, sr] of LUNAR_LR_TERMS) {
    const arg = (cd * d + cm * m + cmp * mp + cf * f) * DEG2RAD;
    const mult = Math.abs(cm) === 2 ? e2 : Math.abs(cm) === 1 ? e : 1;
    sumL += sl * mult * Math.sin(arg);
    sumR += sr * mult * Math.cos(arg);
  }

  let sumB = 0;
  for (const [cd, cm, cmp, cf, sb] of LUNAR_B_TERMS) {
    const arg = (cd * d + cm * m + cmp * mp + cf * f) * DEG2RAD;
    const mult = Math.abs(cm) === 2 ? e2 : Math.abs(cm) === 1 ? e : 1;
    sumB += sb * mult * Math.sin(arg);
  }

  const lonDeg = mod360(lp + sumL / 1_000_000);
  const latDeg = sumB / 1_000_000;
  const distanceKm = 385000.56 + sumR / 1000;

  const lonRad = lonDeg * DEG2RAD;
  const latRad = latDeg * DEG2RAD;

  const elongDeg = mod360(lonDeg - solar.sunApparentLongitudeRad * RAD2DEG);
  const elongRad = elongDeg * DEG2RAD;

  const cosPsi = clamp(Math.cos(latRad) * Math.cos(elongRad), -1, 1);
  const psi = Math.acos(cosPsi);
  const rKm = solar.earthSunDistanceAU * AU_IN_KM;
  const phaseAngleRad = Math.atan2(rKm * Math.sin(psi), distanceKm - rKm * Math.cos(psi));
  const illumination = clamp((1 + Math.cos(phaseAngleRad)) * 0.5, 0, 1);

  const synodicAgeDays = (elongDeg / 360) * SYNODIC_MONTH_DAYS;
  const waxing = elongDeg < 180;
  const apparentScale = MEAN_LUNAR_DISTANCE_KM / distanceKm;

  let libLonDeg = lp - lonDeg;
  if (libLonDeg > 180) libLonDeg -= 360;
  if (libLonDeg < -180) libLonDeg += 360;
  const librationLonRad = clamp(libLonDeg, -8, 8) * DEG2RAD;
  const librationLatRad = clamp(-latDeg, -7, 7) * DEG2RAD;
  const earthshine = (1 - illumination) ** 1.35;

  return {
    longitudeRad: lonRad,
    latitudeRad: latRad,
    distanceKm,
    elongationRad: elongRad,
    phaseAngleRad,
    illumination,
    synodicAgeDays,
    waxing,
    apparentScale,
    librationLonRad,
    librationLatRad,
    earthshine,
  };
}

export function computeTidalState(jd: number, solar: SolarState, lunar: LunarState): TidalState {
  const lunarPotential = (MEAN_LUNAR_DISTANCE_KM / lunar.distanceKm) ** 3;
  const solarPotential = 0.4605 * (1.0 / solar.earthSunDistanceAU) ** 3;

  const combinedAmplitude = Math.sqrt(
    lunarPotential * lunarPotential +
      solarPotential * solarPotential +
      2 * lunarPotential * solarPotential * Math.cos(2 * lunar.elongationRad),
  );

  // Typical theoretical bounds: apogean neap (~0.38) to perigean spring (~1.72)
  const springNeapIndex = clamp((combinedAmplitude - 0.38) / (1.72 - 0.38), 0, 1);

  // Principal lunar semi-diurnal M2 tide advances ~24.38 deg/day (~50 min lunar day lag)
  const daysSinceJ2000 = jd - J2000_JD;
  const m2PeriodDays = 12.4206012 / 24;
  const semiDiurnalPhaseRad = (((daysSinceJ2000 / m2PeriodDays) % 1) + 1) % 1;
  const m2Angle = semiDiurnalPhaseRad * Math.PI * 2;

  const diurnalMod = 0.14 * Math.sin(solar.sunDeclinationRad) * Math.sin(lunar.latitudeRad * 2);
  const rawWave = Math.cos(m2Angle) + diurnalMod;
  const envelope = 0.32 + 0.68 * springNeapIndex;
  const waterLevel = clamp(rawWave * envelope, -1, 1);
  const swellEnergy = clamp(0.25 + 0.75 * springNeapIndex, 0, 1);

  return {
    lunarPotential,
    solarPotential,
    combinedAmplitude,
    springNeapIndex,
    semiDiurnalPhaseRad: m2Angle,
    waterLevel,
    swellEnergy,
  };
}

export function computeGalacticState(jd: number): GalacticState {
  const epochYearsSinceJ2000 = (jd - J2000_JD) / 365.25;
  const galacticOrbitAngleRad = (epochYearsSinceJ2000 / GALACTIC_YEAR_YEARS) * Math.PI * 2;
  const axialPrecessionRad = epochYearsSinceJ2000 * (50.28796 / 3600) * DEG2RAD;
  const solarDistanceBillionKm = epochYearsSinceJ2000 * 7.253;

  return {
    epochYearsSinceJ2000,
    galacticOrbitAngleRad,
    axialPrecessionRad,
    solarDistanceBillionKm,
    solarApexLonRad: 56.2 * DEG2RAD,
    solarApexLatRad: 22.8 * DEG2RAD,
  };
}

export function computeCosmicState(isoDate: string): CosmicState {
  const parsed = parseIsoDate(isoDate) ?? { year: 2026, month: 11, day: 24 };
  const normalizedIso = formatIsoDate(parsed.year, parsed.month, parsed.day);
  const jd = toJulianDay(parsed.year, parsed.month, parsed.day, 12);
  const solar = computeSolarState(jd);
  const lunar = computeLunarState(jd, solar);
  const tidal = computeTidalState(jd, solar, lunar);
  const galactic = computeGalacticState(jd);

  return {
    isoDate: normalizedIso,
    date: parsed,
    solar,
    lunar,
    tidal,
    galactic,
  };
}

/**
 * Computes the unit vector from Earth toward the Sun in right-handed ecliptic
 * world coordinates (+X = Vernal Equinox, +Y = Ecliptic North, -Z = Summer Solstice Sun).
 */
export function computeSunDirectionEcliptic(solar: SolarState): [number, number, number] {
  const lon = solar.earthHeliocentricLongitudeRad;
  return [-Math.cos(lon), 0, Math.sin(lon)];
}

/**
 * Computes the geocentric unit direction from Earth toward the Moon in right-handed
 * ecliptic world coordinates (+X = Vernal Equinox, +Y = Ecliptic North,
 * -Z = Summer Solstice Sun).
 */
export function computeLunarDirectionEcliptic(lunar: LunarState): [number, number, number] {
  const cosLat = Math.cos(lunar.latitudeRad);
  return [
    cosLat * Math.cos(lunar.longitudeRad),
    Math.sin(lunar.latitudeRad),
    -cosLat * Math.sin(lunar.longitudeRad),
  ];
}

/**
 * Transforms a geographic point (latitude, longitude in radians, East positive)
 * into its unit surface normal in right-handed ecliptic world coordinates
 * matching Three.js SphereGeometry with earthAxisGroup.rotation.x = -obliquityRad
 * and earthSpinGroup.rotation.y = gmstRad.
 */
export function geographicToEclipticNormal(
  latRad: number,
  lonRad: number,
  obliquityRad: number,
  gmstRad: number,
): [number, number, number] {
  // Equatorial right ascension of the geographic meridian
  const ra = lonRad + gmstRad;
  const cosLat = Math.cos(latRad);
  const xEq = cosLat * Math.cos(ra);
  const yEq = Math.sin(latRad);
  const zEq = -cosLat * Math.sin(ra);

  // Rotate around +X by -obliquityRad (Earth's North Pole tilts toward -Z = Summer Solstice Sun)
  const cosE = Math.cos(obliquityRad);
  const sinE = Math.sin(obliquityRad);
  const xEcl = xEq;
  const yEcl = yEq * cosE + zEq * sinE;
  const zEcl = -yEq * sinE + zEq * cosE;

  return [xEcl, yEcl, zEcl];
}
