export const earthVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  vec3 localTangent = normalize(vec3(sin(uv.x * 6.2831853), 0.0, cos(uv.x * 6.2831853)));
  vTangent = normalize(mat3(modelMatrix) * localTangent);
  vBitangent = normalize(cross(vWorldNormal, vTangent));

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const earthFragmentShader = /* glsl */ `
uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform sampler2D uCloudMap;
uniform sampler2D uSpecularMap;
uniform sampler2D uNormalMap;
uniform vec3 uSunDir;
uniform float uCloudOffset;
uniform float uOpacity;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
  mapN.xy *= 0.38;
  vec3 bumpedN = normalize(vTangent * mapN.x + vBitangent * mapN.y + N * mapN.z);

  vec3 dayColor = texture2D(uDayMap, vUv).rgb;
  vec3 nightLights = texture2D(uNightMap, vUv).rgb;
  float oceanMask = texture2D(uSpecularMap, vUv).r;

  vec2 cloudUv = vec2(fract(vUv.x + uCloudOffset), vUv.y);
  float cloudDensity = texture2D(uCloudMap, cloudUv).r;
  vec2 shadowUv = vec2(fract(vUv.x + uCloudOffset - 0.0024), clamp(vUv.y + 0.0012, 0.001, 0.999));
  float cloudShadow = texture2D(uCloudMap, shadowUv).r;

  float ndl = dot(N, L);
  float bumpedNdl = dot(bumpedN, L);
  float dayFactor = smoothstep(-0.08, 0.16, ndl);
  float diffuse = max(bumpedNdl, 0.0);

  float shadowAtten = 1.0 - cloudShadow * 0.24 * smoothstep(0.0, 0.28, ndl);
  vec3 litDay = dayColor * (0.06 + 1.38 * pow(diffuse, 0.82)) * shadowAtten;

  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float specSharp = pow(ndh, 90.0) * 0.62;
  float specBroad = pow(ndh, 18.0) * 0.16;
  float ndv = max(dot(N, V), 0.0);
  float fresnel = pow(1.0 - ndv, 3.8);
  vec3 oceanSpec = vec3(1.0, 0.96, 0.9) * (specSharp + specBroad) * oceanMask * smoothstep(0.02, 0.26, ndl) * (1.0 - cloudDensity * 0.82);
  vec3 oceanFresnel = vec3(0.14, 0.42, 0.82) * fresnel * oceanMask * 0.42 * dayFactor;

  float terminatorBand = exp(-pow((ndl + 0.015) / 0.048, 2.0));
  vec3 twilightTint = vec3(0.95, 0.42, 0.18) * terminatorBand * 0.12 * (1.0 - cloudDensity * 0.4);

  float limbScatter = pow(1.0 - ndv, 3.1) * smoothstep(-0.14, 0.3, ndl);
  vec3 rayleigh = vec3(0.24, 0.6, 1.0) * limbScatter * 0.72;

  float nightFactor = smoothstep(0.06, -0.18, ndl);
  vec3 cityGlow = nightLights * vec3(1.0, 0.8, 0.48) * nightFactor * (1.0 - cloudDensity * 0.56) * 1.9;

  // Starlight & moonlit fill so the darkest side retains readable landmass/ocean contrast and form
  float nightRelief = 0.76 + 0.24 * max(dot(bumpedN, normalize(V + vec3(0.0, 0.28, 0.0))), 0.0);
  vec3 nightLand = (dayColor * vec3(0.11, 0.155, 0.245) + vec3(0.016, 0.026, 0.048)) * nightRelief;
  vec3 nightOcean = (dayColor * vec3(0.068, 0.105, 0.178) + vec3(0.008, 0.016, 0.036)) * nightRelief;
  vec3 nightAmbient = mix(nightLand, nightOcean, oceanMask) * (0.45 + 0.55 * nightFactor);

  // Subtle cool atmospheric rim along the dark limb so Earth's spherical outline stays clearly defined
  float nightLimb = pow(1.0 - ndv, 2.8) * (1.0 - dayFactor * 0.85);
  vec3 nightRim = vec3(0.16, 0.33, 0.62) * nightLimb * 0.48;

  vec3 color = mix(nightAmbient + cityGlow, litDay + oceanSpec + oceanFresnel, dayFactor) + twilightTint + rayleigh + nightRim;
  gl_FragColor = vec4(color, uOpacity);
}
`;

export const cloudsVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const cloudsFragmentShader = /* glsl */ `
uniform sampler2D uCloudMap;
uniform vec3 uSunDir;
uniform float uCloudOffset;
uniform float uOpacity;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec2 cloudUv = vec2(fract(vUv.x + uCloudOffset), vUv.y);
  float cloud = texture2D(uCloudMap, cloudUv).r;
  float alpha = smoothstep(0.14, 0.86, cloud) * 0.88;
  if (alpha < 0.01) discard;

  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  float ndv = max(dot(N, V), 0.0);

  float lit = smoothstep(-0.1, 0.24, ndl);
  float sunset = exp(-pow((ndl + 0.01) / 0.055, 2.0));
  vec3 dayCol = vec3(0.97, 0.99, 1.0) * (0.24 + 0.95 * pow(max(ndl, 0.0), 0.78));
  vec3 sunsetCol = vec3(1.0, 0.56, 0.28) * sunset * 0.16;
  vec3 nightCol = vec3(0.055, 0.085, 0.145) + vec3(0.04, 0.075, 0.14) * pow(1.0 - ndv, 2.4);

  vec3 color = mix(nightCol, dayCol, lit) + sunsetCol;
  gl_FragColor = vec4(color, alpha * uOpacity);
}
`;

export const atmosphereVertexShader = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const atmosphereFragmentShader = /* glsl */ `
uniform vec3 uSunDir;
uniform float uOpacity;

varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  float viewDot = max(dot(-N, V), 0.0);
  float rim = pow(clamp(1.0 - viewDot, 0.0, 1.0), 3.3);
  float outerFalloff = smoothstep(0.0, 0.36, viewDot);

  float ndl = dot(N, L);
  float sunMask = smoothstep(-0.26, 0.36, ndl);
  float sunsetBand = exp(-pow((ndl + 0.02) / 0.12, 2.0));

  vec3 dayHalo = vec3(0.24, 0.62, 1.0);
  vec3 nightHalo = vec3(0.14, 0.32, 0.64);
  vec3 sunsetHalo = vec3(0.95, 0.48, 0.24);
  vec3 baseHalo = mix(nightHalo, dayHalo, sunMask);
  vec3 color = mix(baseHalo, sunsetHalo, sunsetBand * 0.25);

  float intensity = rim * outerFalloff * (0.24 + 0.76 * sunMask) * 1.48;
  gl_FragColor = vec4(color * intensity, intensity * uOpacity);
}
`;

export const moonVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  vec3 localTangent = normalize(vec3(sin(uv.x * 6.2831853), 0.0, cos(uv.x * 6.2831853)));
  vTangent = normalize(mat3(modelMatrix) * localTangent);
  vBitangent = normalize(cross(vWorldNormal, vTangent));

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const moonFragmentShader = /* glsl */ `
uniform sampler2D uMoonMap;
uniform vec3 uSunDir;
uniform float uEarthshine;
uniform float uOpacity;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  vec3 albedo = texture2D(uMoonMap, vUv).rgb;

  vec2 texel = vec2(1.0 / 2048.0, 1.0 / 1024.0);
  float hL = luma(texture2D(uMoonMap, vUv - vec2(texel.x, 0.0)).rgb);
  float hR = luma(texture2D(uMoonMap, vUv + vec2(texel.x, 0.0)).rgb);
  float hD = luma(texture2D(uMoonMap, vUv - vec2(0.0, texel.y)).rgb);
  float hU = luma(texture2D(uMoonMap, vUv + vec2(0.0, texel.y)).rgb);

  float bumpStrength = 2.8;
  vec3 craterN = normalize(N - vTangent * (hR - hL) * bumpStrength - vBitangent * (hU - hD) * bumpStrength);

  float geomNdl = dot(N, L);
  float ndl = max(dot(craterN, L), 0.0);
  float ndv = max(dot(craterN, V), 0.04);

  // Lommel-Seeliger lunar regolith reflectance
  float lommel = ndl / (ndl + ndv * 0.72 + 0.05);
  float softTerm = smoothstep(-0.04, 0.08, geomNdl);
  float litMask = softTerm * mix(ndl, lommel * 1.55, 0.78);

  vec3 sunlit = albedo * vec3(1.03, 1.0, 0.95) * litMask * 1.38;

  // Cool slate-blue Earthshine illuminating the dark lunar disk so even New Moon reads subtly
  float darkSide = 1.0 - smoothstep(-0.08, 0.14, geomNdl);
  float rimSoft = 0.7 + 0.35 * pow(1.0 - max(dot(N, V), 0.0), 2.2);
  vec3 earthshineCol =
    albedo * vec3(0.14, 0.2, 0.32) * (0.14 + 0.34 * uEarthshine) * darkSide * rimSoft +
    vec3(0.04, 0.07, 0.13) * pow(1.0 - max(dot(N, V), 0.0), 3.6) * darkSide * (0.35 + 0.65 * uEarthshine);

  vec3 color = sunlit + earthshineCol;
  gl_FragColor = vec4(color, uOpacity);
}
`;

export const moonHaloVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const moonHaloFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uMoonIllumination;

varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  // Soft atmospheric Mie/Rayleigh lunar scatter scaling naturally with illuminated fraction
  float illum = pow(clamp(uMoonIllumination, 0.0001, 1.0), 1.15);
  float innerGlow = exp(-r * 5.2) * (0.04 + 0.42 * illum);
  float midHalo = exp(-r * 2.45) * (0.015 + 0.16 * illum);
  float outerVeil = pow(max(1.0 - r, 0.0001), 2.8) * (0.008 + 0.07 * illum);

  vec3 col =
    vec3(0.84, 0.90, 1.0) * innerGlow +
    vec3(0.46, 0.62, 0.88) * midHalo +
    vec3(0.24, 0.38, 0.64) * outerVeil;

  float alpha = clamp((innerGlow + midHalo + outerVeil) * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(col * uOpacity, alpha);
}
`;

export const lunarGuideVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lunarGuideFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uSynodicAge;
uniform float uMoonClearInner;
uniform float uMoonClearOuter;
uniform float uHalfSpan;
uniform float uDaySpacing;

varying vec2 vUv;

void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  // Compute derivative on linear vUv.y (not abs()) so 2x2 pixel quads straddling the centerline
  // never cancel dFdy to zero and create periodic darkened bands along gentle horizontal curves
  float fwY = max(length(vec2(dFdx(vUv.y), dFdy(vUv.y))) * 2.0, 0.001);

  float absAlong = abs(vUv.x);
  // Crisp clearance gap around the Moon disc (scales dynamically with perigee/apogee diameter)
  float moonClear = smoothstep(uMoonClearInner, uMoonClearOuter, absAlong);
  float endFade = smoothstep(uHalfSpan, uHalfSpan * 0.28, absAlong);
  if (moonClear * endFade < 0.002) discard;

  // Partition-of-unity 1px-feathered hairline: constant integrated brightness at every sub-pixel offset
  float hairline = 1.0 - smoothstep(fwY * 0.5, fwY * 1.5, across);

  // Perpendicular engineering graduations synced 1:1 with lunar synodic age:
  // minor tick = 1 exact day, major tick = exact phase quarter (29.530588853 / 4 = 7.382647213d)
  float dayCoord = vUv.x / uDaySpacing + uSynodicAge;
  float fwDay = max(fwidth(dayCoord), 0.004);
  float dayAA = smoothstep(0.28, 0.08, fwDay);
  float dayTick = (1.0 - smoothstep(fwDay * 0.45, fwDay * 1.55, abs(fract(dayCoord + 0.5) - 0.5))) *
    (1.0 - smoothstep(0.32, 0.32 + fwY * 1.2, across)) * dayAA;

  float quarterCoord = dayCoord / 7.38264721325;
  float fwQuarter = max(fwidth(quarterCoord), 0.002);
  float quarterAA = smoothstep(0.28, 0.08, fwQuarter);
  float quarterTick = (1.0 - smoothstep(fwQuarter * 0.5, fwQuarter * 1.6, abs(fract(quarterCoord + 0.5) - 0.5))) *
    (1.0 - smoothstep(0.74, 0.74 + fwY * 1.2, across)) * quarterAA;

  vec3 color = vec3(0.92, 0.94, 0.98);
  float shape = max(hairline * 0.34, max(dayTick * 0.3, quarterTick * 0.54));
  float alpha = clamp(shape * endFade * moonClear * uOpacity, 0.0, 1.0);
  if (alpha < 0.003) discard;

  gl_FragColor = vec4(color, alpha);
}
`;

export const oceanVertexShader = /* glsl */ `
uniform float uTime;
uniform float uTideLevel;
uniform float uSwellEnergy;

varying vec3 vWorldPos;
varying vec3 vLocalPos;
varying vec2 vWaveSlope;
varying float vWaveCrest;
varying float vWaveHeight;

float shoreCenterX(float z) {
  float d = 1.0 - z;
  float base = -0.46 + 0.35 * d + 0.0018 * d * d;
  float cusps = 0.16 * sin(z * 0.42 + 0.6) + 0.085 * sin(z * 0.93 - 1.15);
  return base + cusps;
}

float beachBedHeight(float s) {
  float slope = s * 0.072;
  float uBerm = max(s - 0.45, 0.0);
  float upperBerm = 0.012 * uBerm * sqrt(uBerm);
  float uDeep = max(-s - 2.2, 0.0);
  float deepDrop = -0.018 * uDeep * (0.65 + 0.12 * uDeep);
  return slope + upperBerm + deepDrop;
}

float evalOceanWaves(float s, float sRel, float along, float t, float swellEnergy, out float crestOut) {
  // Waves compress slightly and shoal as they approach the beach (sRel -> 0)
  float shoalBoost = 1.0 + 0.42 * exp(-pow((sRel + 1.15) / 0.95, 2.0));
  float shoreAtten = smoothstep(0.18, -0.58, sRel);
  float amp = (0.024 + 0.048 * swellEnergy) * shoalBoost * shoreAtten;

  // Primary long-period ocean swell rolling diagonally onto the beach in world coordinates
  // (anchored to world s so tide-level shifts never drag open-ocean swells sideways)
  float p1 = s * 1.55 + along * 0.32 - t * 0.88 + 0.45 * sin(along * 0.24 - t * 0.18);
  float w1 = (pow(max(0.5 + 0.5 * sin(p1), 0.0001), 1.6) - 0.42) * amp * 1.48;

  // Secondary cross-swell creating natural wave sets
  float p2 = s * 2.25 - along * 0.62 - t * 1.18;
  float w2 = (pow(max(0.5 + 0.5 * sin(p2), 0.0001), 1.45) - 0.44) * amp * 0.62;

  // Shorter wind swell
  float p3 = s * 3.55 + along * 1.15 - t * 1.62;
  float w3 = sin(p3) * amp * 0.24;

  float total = w1 + w2 + w3;
  // Breaking crest energy peaks in the shallow surf zone in organic along-shore pockets
  float breakerZone = exp(-pow((sRel + 1.15) / 0.78, 2.0));
  float alongBreak = 0.62 + 0.38 * sin(along * 0.58 + 0.9) * cos(along * 0.27 - t * 0.09);
  crestOut = clamp((w1 / max(amp, 0.001) - 0.24) * 1.32, 0.0, 1.0) * breakerZone * alongBreak;
  return total;
}

float sampleWaveAtXZ(float x, float z, float sEq, float t, float swellEnergy) {
  float shoreX = shoreCenterX(z);
  float s = (x - shoreX) * 0.946;
  float along = z * 0.946 - x * 0.322;
  float dummyCrest = 0.0;
  return evalOceanWaves(s, s - sEq, along, t, swellEnergy, dummyCrest);
}

void main() {
  vec3 pos = position;

  float shoreX = shoreCenterX(pos.z);
  float s = (pos.x - shoreX) * 0.946;
  float along = pos.z * 0.946 - pos.x * 0.322;

  float tideBaseY = mix(-0.062, 0.068, uTideLevel);
  float sEq = tideBaseY / 0.072;
  float sRel = s - sEq;

  float distZ = max(0.0, 2.0 - pos.z);
  float nearFade = smoothstep(78.0, 10.0, distZ);
  float horizonCurve = -0.000045 * max(distZ - 26.0, 0.0) * max(distZ - 26.0, 0.0);

  float crest = 0.0;
  float rawWaveH = evalOceanWaves(s, sRel, along, uTime, uSwellEnergy, crest);
  float waveH = rawWaveH * nearFade;
  float sandH = beachBedHeight(s);

  // Smooth per-vertex macro swell slope for sculpted 3D rolling wave lighting
  float eps = 0.09;
  float wx = sampleWaveAtXZ(pos.x + eps, pos.z, sEq, uTime, uSwellEnergy);
  float wz = sampleWaveAtXZ(pos.x, pos.z + eps, sEq, uTime, uSwellEnergy);
  vWaveSlope = vec2((rawWaveH - wx) / eps, (rawWaveH - wz) / eps) * nearFade;

  // Unified surface: seamless beach bed above water, continuous ocean surface over seabed
  float waterY = tideBaseY + waveH;
  float surfaceY = max(sandH, waterY) + horizonCurve;
  pos.y = surfaceY;

  vLocalPos = pos;
  vWaveCrest = crest * nearFade;
  vWaveHeight = waveH;

  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const oceanFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uLocalCamPos;
uniform float uMoonIllumination;
uniform float uSwellEnergy;
uniform float uTideLevel;
uniform float uWetTideMemory;
uniform float uOpacity;

varying vec3 vWorldPos;
varying vec3 vLocalPos;
varying vec2 vWaveSlope;
varying float vWaveCrest;
varying float vWaveHeight;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.04 + vec2(13.7, 7.3);
    a *= 0.5;
  }
  return v;
}

// Lacy cellular seafoam pattern (interconnected thin filaments & fine bubbles)
float foamLace(vec2 p, float t) {
  vec2 q = p + vec2(fbm(p * 0.75 + vec2(t * 0.05, -t * 0.03)), fbm(p * 0.75 + vec2(5.2, 1.3))) * 0.45;
  float n1 = fbm(q * 1.45);
  float n2 = fbm(q * 3.6 - vec2(t * 0.06, 0.0));
  float fine = noise(q * 11.5);
  // Invert ridged noise into organic lacy foam strands
  float web = 1.0 - abs(n1 * 2.0 - 1.0);
  web = pow(clamp(web, 0.0001, 1.0), 2.4);
  float cells = smoothstep(0.34, 0.78, n2 * 0.65 + fine * 0.35);
  return clamp(web * 0.78 + cells * 0.42, 0.0, 1.0);
}

float shoreCenterX(float z) {
  float d = 1.0 - z;
  float base = -0.46 + 0.35 * d + 0.0018 * d * d;
  float cusps = 0.16 * sin(z * 0.42 + 0.6) + 0.085 * sin(z * 0.93 - 1.15);
  return base + cusps;
}

float beachBedHeight(float s) {
  float slope = s * 0.072;
  float uBerm = max(s - 0.45, 0.0);
  float upperBerm = 0.012 * uBerm * sqrt(uBerm);
  float uDeep = max(-s - 2.2, 0.0);
  float deepDrop = -0.018 * uDeep * (0.65 + 0.12 * uDeep);
  return slope + upperBerm + deepDrop;
}

// Smooth C1-continuous coastal swash cycle: gentle surf emergence, brisk uprush, soft apex hang, thinning backwash
void swashCycle(float cyc, out float reach, out float vel, out float freshUprush) {
  float c = fract(cyc);
  if (c < 0.38) {
    float u = c / 0.38;
    float s = sin(u * 1.5707963);
    float co = cos(u * 1.5707963);
    reach = pow(max(s, 0.0001), 1.72);
    // Smooth derivative: starts at 0 at c=0 (no pop-in), peaks briskly mid-uprush, eases to 0 at apex
    vel = clamp(1.72 * pow(max(s, 0.0001), 0.72) * co * 1.18, 0.0, 1.0);
    freshUprush = smoothstep(0.05, 0.32, u) * (1.0 - smoothstep(0.76, 1.0, u));
  } else if (c < 0.48) {
    float u = (c - 0.38) / 0.10;
    reach = 1.0 - 0.02 * u * u;
    vel = -0.05 * u;
    freshUprush = 0.0;
  } else {
    float u = (c - 0.48) / 0.52;
    float co = cos(u * 1.5707963);
    float s = sin(u * 1.5707963);
    reach = 0.98 * pow(max(co, 0.0001), 1.42);
    // Smooth derivative: returns cleanly to 0 as backwash dissolves into surf at c=1
    vel = -clamp(1.42 * pow(max(co, 0.0001), 0.42) * s * 1.12, 0.0, 1.0);
    freshUprush = 0.0;
  }
}

// Fine anisotropic ocean ripples stretched parallel to wave crests
float waveField(vec2 p, float t) {
  vec2 a = vec2(p.x * 0.92, p.y * 1.52);
  float h = 0.0;
  h += noise(a * 0.95 + vec2(-t * 0.24, t * 0.14)) * 0.44;
  h += noise(a * 2.35 + vec2(-t * 0.36, -t * 0.22)) * 0.28;
  h += noise(a * 5.6 + vec2(-t * 0.54, t * 0.34)) * 0.16;
  h += noise(a * 12.8 + vec2(-t * 0.78, -t * 0.52)) * 0.08;
  h += noise(a * 26.0 + vec2(-t * 1.05, t * 0.68)) * 0.04;
  return h;
}

void main() {
  vec2 xz = vLocalPos.xz;
  vec3 localToCam = uLocalCamPos - vLocalPos;
  float distCam = length(localToCam);
  float distZ = max(0.0, 2.0 - vLocalPos.z);

  float shoreX = shoreCenterX(vLocalPos.z);
  float s = (vLocalPos.x - shoreX) * 0.946;
  float along = vLocalPos.z * 0.946 - vLocalPos.x * 0.322;

  float tideBaseY = mix(-0.062, 0.068, uTideLevel);
  float sEq = tideBaseY / 0.072;
  float sRel = s - sEq;

  // Evaluate a coherent 2-wave coastal swash train (half-cycle offset from the same swell)
  // so an incoming lower wave naturally rolls in as a soft frothy bore and seamlessly overtakes
  // the receding upper swash edge without artificial duplicate ribbons or retreating ghost lines.
  float edgeS[2];
  float waveReach[2];
  float waveVel[2];
  float waveUprush[2];

  float basePeriod = 9.2;
  float sharedWarp = fbm(vec2(along * 0.20, 1.7));

  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float localWarp = (fbm(vec2(along * 0.28 + fk * 4.3, uTime * 0.018 + fk * 2.1)) - 0.5) * 0.16;
    float cyc = uTime / basePeriod - along * 0.048 - sharedWarp * 0.24 + localWarp + fk * 0.5;

    float reach = 0.0;
    float vel = 0.0;
    float uprush = 0.0;
    swashCycle(cyc, reach, vel, uprush);

    // Gentle wave-set amplitude modulation so consecutive waves vary organically in reach
    float setMod = 0.92 + 0.11 * sin(uTime * 0.23 + fk * 2.4 + along * 0.14);

    // Smoothly evolving scalloped water tongues (gentler in the surf, fuller up on the sand)
    float scallopMacro = (fbm(vec2(along * 0.55 + fk * 5.3, uTime * 0.048 + fk * 1.7)) - 0.5) * 0.44;
    float scallopMicro = (fbm(vec2(along * 2.15 - fk * 2.7, uTime * 0.085 + fk * 4.1)) - 0.5) * 0.15;
    float scallop = (scallopMacro + scallopMicro) * (0.22 + 0.78 * reach);

    float maxRunup = (0.90 + 0.58 * uSwellEnergy) * setMod;
    edgeS[k] = -0.54 + maxRunup * reach + scallop;
    waveReach[k] = reach;
    waveVel[k] = vel;
    waveUprush[k] = uprush;
  }

  float outerEdgeS = max(edgeS[0], edgeS[1]);

  float swashDepth = 0.0;
  float leadingFoam = 0.0;
  float innerBoreFoam = 0.0;
  float trailFoam = 0.0;
  float meniscusRim = 0.0;
  float meniscusSlope = 0.0;
  float contactShadow = 0.0;

  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float reach = waveReach[k];
    float vel = waveVel[k];
    float uprush = waveUprush[k];
    float distBehind = edgeS[k] - sRel;

    // Smoothly distinguish the outermost wave touching sand (isOuter -> 1)
    // from an incoming lower wave rolling over existing shallow backwash (isInner -> 1)
    float behindOuter = max(outerEdgeS - edgeS[k], 0.0);
    float isOuter = 1.0 - smoothstep(0.0, 0.16, behindOuter);
    float isInner = 1.0 - isOuter;

    // Only an actively advancing inner wave creates a rolling bore; retreating submerged sheets dissolve cleanly
    float innerAdvance = isInner * smoothstep(0.04, 0.34, vel) * smoothstep(0.06, 0.30, reach);

    // Subtle micro contact shadow on dry/wet sand ONLY ahead of the outermost water-to-sand lip
    float shadow = exp(-pow((distBehind + 0.008) / 0.016, 2.0))
      * (0.22 + 0.78 * smoothstep(-0.25, 0.45, vel)) * isOuter;
    contactShadow = max(contactShadow, shadow);

    if (distBehind > -0.06) {
      // Thin physical water film tapering smoothly into a curved liquid meniscus at the outer shoreline
      float sheet = smoothstep(0.0, 0.26, distBehind) * (0.011 + 0.022 * reach * (0.42 + 0.58 * uSwellEnergy));
      // Tiny raised capillary lip at the outer sand boundary + broader rolling water step on an advancing inner bore
      float outerLip = exp(-pow((distBehind - 0.024) / 0.026, 2.0)) * (0.0028 + 0.0050 * uprush) * isOuter;
      float innerRoll = exp(-pow((distBehind - 0.060) / 0.085, 2.0)) * 0.0055 * innerAdvance;
      float layerDepth = sheet + (outerLip + innerRoll) * smoothstep(-0.01, 0.02, distBehind);
      swashDepth = max(swashDepth, layerDepth);

      // Curved 3D wave slope:
      // - Outer wave: crisp narrow liquid lip catching lunar glint on sand
      // - Inner advancing roller: softer, broader rolling swell front catching gentle moonlight
      float outerSlope = -((distBehind - 0.024) / 0.024) * exp(-pow((distBehind - 0.024) / 0.024, 2.0))
        * (0.26 + 0.74 * uprush) * isOuter;
      float innerSlope = -((distBehind - 0.065) / 0.078) * exp(-pow((distBehind - 0.065) / 0.078, 2.0))
        * 0.52 * innerAdvance;
      float combinedSlope = outerSlope + innerSlope;
      if (abs(combinedSlope) > abs(meniscusSlope)) {
        meniscusSlope = combinedSlope;
      }

      // Razor-thin specular meniscus ONLY at the outer water-meets-sand boundary
      float rim = exp(-pow((distBehind - 0.022) / 0.020, 2.0))
        * (0.20 + 0.80 * smoothstep(-0.35, 0.45, vel)) * isOuter;
      meniscusRim = max(meniscusRim, rim);

      // Leading-edge lacy seafoam concentrated along the outermost shoreline
      float lipBand = smoothstep(-0.006, 0.016, distBehind)
        * exp(-max(distBehind - 0.014, 0.0) / (0.088 + 0.055 * uprush));
      float lipStrength = (0.28 + 0.72 * smoothstep(-0.45, 0.45, vel)) * (0.55 + 0.45 * uSwellEnergy) * isOuter;
      leadingFoam = max(leadingFoam, lipBand * lipStrength);

      // Soft, organically feathered tumbling whitewater bore for an incoming lower wave rolling over backwash
      float boreFront = smoothstep(-0.045, 0.075, distBehind)
        * exp(-max(distBehind - 0.055, 0.0) / (0.20 + 0.12 * uprush));
      float boreAlongVar = 0.48 + 0.52 * fbm(vec2(along * 0.62 + fk * 3.7, uTime * 0.055 + fk * 1.9));
      innerBoreFoam = max(innerBoreFoam, boreFront * boreAlongVar * innerAdvance * (0.45 + 0.55 * uSwellEnergy));

      // Delicate gossamer trailing foam web dragged across the shallow water sheet
      float trailBand = smoothstep(0.02, 0.14, distBehind) * exp(-max(distBehind - 0.12, 0.0) / 0.46);
      float trailFade = (0.22 + 0.52 * reach) * (isOuter + innerAdvance * 0.45);
      trailFoam = max(trailFoam, trailBand * trailFade * (0.45 + 0.55 * uSwellEnergy));
    }
  }

  // Smooth continuous wet-sand high-water reach envelope (never jumps between wave cycles)
  float peakReachEnv = -0.44 + (0.90 + 0.58 * uSwellEnergy)
    + (fbm(vec2(along * 0.52, uTime * 0.025)) - 0.5) * 0.30;

  float sandH = beachBedHeight(s);
  float deepDepth = max(0.0, (tideBaseY + vWaveHeight) - sandH);
  float waterDepth = max(deepDepth, swashDepth);

  // Distance attenuation for micro-detail to avoid shimmer near the far horizon
  float detailFade = mix(1.0, 0.35, clamp(distCam / 26.0, 0.0, 1.0));
  float eps = mix(0.024, 0.095, clamp(distCam / 28.0, 0.0, 1.0));

  vec3 V = normalize(localToCam);
  vec3 L = normalize(uMoonDir);
  float illumPow = pow(clamp(uMoonIllumination, 0.0001, 1.0), 0.85);
  // Directional moonlight specular (glitter path & wet-sand glint) drops realistically near zero at New Moon,
  // while cool starlight ambient keeps waves, foam edge, and beach delicately readable at all phases.
  float moonSpecBright = 0.015 + 0.985 * illumPow;
  float moonBright = 0.10 + 0.90 * illumPow;
  vec3 moonColor = vec3(0.88, 0.93, 1.0);
  vec3 starAmbient = vec3(0.085, 0.125, 0.195);

  // ---------------- SAND & GLOSSY WET BEACH ----------------
  // Wet sand envelope: recently washed swash zone + slower receding tidal memory pinned to world sand
  float wetMemoryExtra = max(uWetTideMemory - uTideLevel, 0.0) * 2.26;
  float wetNoise = (fbm(vec2(along * 0.95, s * 1.4)) - 0.5) * 0.18;
  float wetLimitS = peakReachEnv + 0.18 + wetMemoryExtra + wetNoise;
  float wetness = smoothstep(wetLimitS + 0.28, wetLimitS - 0.08, sRel);
  float dampness = smoothstep(wetLimitS + 0.92, wetLimitS - 0.05, sRel);

  // Fine coastal sand micro-grain & subtle wet wave-wash undulations so reflections look organic, not plastic
  float sandGrain1 = noise(xz * 18.0);
  float sandGrain2 = noise(xz * 54.0 + 3.1);
  float sandRipple = noise(vec2(along * 2.2, s * 6.5));
  float wetMicro1 = noise(vec2(along * 5.2, s * 14.0)) - 0.5;
  float wetMicro2 = noise(vec2(along * 15.0 + 2.3, s * 28.0)) - 0.5;
  float slopeX = 0.072 * 0.946;
  float slopeZ = 0.072 * 0.322;
  vec3 sandN = normalize(vec3(
    -slopeX + ((sandGrain1 - 0.5) * 0.055 * (1.0 - wetness * 0.62) + (wetMicro1 * 0.042 + wetMicro2 * 0.022) * wetness) * detailFade,
    1.0,
    -slopeZ + ((sandGrain2 - 0.5) * 0.055 * (1.0 - wetness * 0.62) + (wetMicro2 * 0.038 - wetMicro1 * 0.024) * wetness) * detailFade
  ));

  // Dark coastal sand palette calibrated for ACESFilmic + sRGB + corner scrim readability
  vec3 drySandAlbedo = vec3(0.076, 0.082, 0.098) * (0.85 + 0.30 * sandRipple) + (sandGrain2 - 0.5) * 0.010;
  vec3 wetSandAlbedo = drySandAlbedo * vec3(0.46, 0.51, 0.62);
  vec3 sandAlbedo = mix(drySandAlbedo, wetSandAlbedo, clamp(wetness * 0.85 + dampness * 0.35, 0.0, 1.0));

  float sandNdl = max(dot(sandN, L), 0.0);
  vec3 sandDiffuse = sandAlbedo * (starAmbient * 1.55 + moonColor * (0.30 + 1.10 * sandNdl) * moonBright);

  // Silky Fresnel sheen on freshly washed wet sand (reflects Moon & night sky with organic sand micro-texture)
  float sandFresnel = pow(clamp(1.0 - max(dot(sandN, V), 0.0), 0.0001, 1.0), 3.6);
  vec3 skyGrad = mix(vec3(0.036, 0.062, 0.112), vec3(0.145, 0.228, 0.365), 0.16 + 0.84 * uMoonIllumination);
  vec3 sandHalfVec = normalize(L + V);
  float sandNdh = max(dot(sandN, sandHalfVec), 0.0001);
  // Subtle broken specular reflection on damp/wet sand directly under the Moon
  float wetSpecBreakup = 0.72 + 0.42 * noise(vec2(along * 3.8, s * 9.5));
  float wetMoonSpec = (pow(sandNdh, 140.0) * 0.92 + pow(sandNdh, 26.0) * 0.24) * moonSpecBright * wetSpecBreakup;
  float dampMoonSpec = pow(sandNdh, 16.0) * 0.085 * moonSpecBright;
  vec3 wetReflect = skyGrad * (0.14 + 0.74 * sandFresnel) + moonColor * wetMoonSpec;

  vec3 sandColor = sandDiffuse
    + wetReflect * wetness * 0.86
    + (skyGrad * 0.14 + moonColor * dampMoonSpec) * dampness * (1.0 - wetness);
  // Crisp micro contact darkening right ahead of the advancing liquid lip
  sandColor *= 1.0 - contactShadow * 0.28;

  // ---------------- OCEAN WATER & SWASH FILM ----------------
  // Anisotropic wave ripples attenuate gracefully in ultra-thin swash film
  float rippleScale = mix(0.28, 1.0, smoothstep(0.002, 0.06, waterDepth));
  float h0 = waveField(xz, uTime);
  float hx = waveField(xz + vec2(eps, 0.0), uTime);
  float hz = waveField(xz + vec2(0.0, eps), uTime);

  float choppiness = (0.14 + 0.19 * uSwellEnergy) * rippleScale * mix(1.0, 0.45, clamp(distCam / 26.0, 0.0, 1.0));
  // Combine sculpted macro swell slopes + capillary ripples + curved swash meniscus lip
  vec2 meniscusTilt = vec2(0.946, 0.322) * meniscusSlope * 0.36;
  vec2 macroSlope = vWaveSlope * smoothstep(0.004, 0.075, waterDepth) * 1.45;
  vec3 waterN = normalize(vec3(
    macroSlope.x + (h0 - hx) / eps * choppiness + meniscusTilt.x,
    1.0,
    macroSlope.y + (h0 - hz) / eps * choppiness + meniscusTilt.y
  ));

  // Physical Schlick Fresnel for water (F0 = 0.02)
  float ndv = max(dot(waterN, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(clamp(1.0 - ndv, 0.0001, 1.0), 4.6);

  // Beer-Lambert shallow water transmittance: thin swash reveals darkened wet sand underneath
  float transmittance = exp(-waterDepth * 38.0);
  vec3 deepWaterCol = vec3(0.007, 0.017, 0.038);
  vec3 shallowTint = vec3(0.014, 0.034, 0.062);
  vec3 waterBody = mix(deepWaterCol, shallowTint, smoothstep(0.18, 0.01, waterDepth));
  vec3 underWater = mix(waterBody, sandColor * 0.78, transmittance * 0.86);

  vec3 waterColor = mix(underWater, skyGrad, clamp(fresnel * 0.84, 0.0, 1.0));

  // Multi-lobe anisotropic moonlight glitter path across waves & thin swash
  vec3 waterH = normalize(L + V);
  float ndh = max(dot(waterN, waterH), 0.0001);
  float glitterPin = pow(ndh, 380.0) * 3.5;
  float glitterMid = pow(ndh, 76.0) * 0.66;
  float glitterWide = pow(ndh, 15.0) * 0.14;
  // Soften pin-glitter slightly in smooth glassy swash film while keeping meniscus highlight crisp
  float glitterMask = mix(0.65, 1.0, rippleScale);
  waterColor += moonColor * (glitterPin * glitterMask + glitterMid + glitterWide) * moonSpecBright;
  waterColor += moonColor * meniscusRim * (0.12 + 0.58 * moonSpecBright) * (0.35 + 0.65 * pow(ndh, 10.0));

  // Subtle moonlit translucency / subsurface glow on shoaling wave crests
  float sssCrest = smoothstep(0.014, 0.052, vWaveHeight) * (0.28 + 0.72 * uSwellEnergy) * (0.22 + 0.78 * moonBright);
  waterColor += vec3(0.12, 0.24, 0.40) * sssCrest * 0.40;

  // ---------------- LACY SEAFOAM & SHOREBREAK ----------------
  // World-space foam coordinates drifting gently shoreward so tide-level shifts never slide foam like a decal
  vec2 foamUv = vec2(along * 1.15, s * 2.1 - uTime * 0.10);
  float lace = foamLace(foamUv, uTime);
  float fineBubbles = noise(foamUv * 9.5 + vec2(uTime * 0.06, 0.0));

  // 1) Crisp lacy foam along the outer swash leading edge where the wave meets sand
  float edgeFoamMask = leadingFoam * smoothstep(0.12, 0.72, lace * 0.8 + fineBubbles * 0.25);
  // Continuous ultra-thin bubbly rim right at the outer advancing lip
  float rimSpark = leadingFoam * smoothstep(0.32, 0.84, leadingFoam + fineBubbles * 0.28) * 0.54;

  // 2) Soft, organically broken frothy whitewater on an incoming lower roller gliding over thin backwash
  float boreTexture = smoothstep(0.24, 0.80, lace * 0.72 + fineBubbles * 0.32);
  float innerBoreMask = innerBoreFoam * boreTexture * 0.68;

  // 3) Gossamer trailing foam lace across the shallow swash sheet
  float trailFoamMask = trailFoam * smoothstep(0.42, 0.86, lace) * 0.64;

  // 4) Soft shorebreak whitewater on shoaling crests in the surf zone
  float breakerNoise = foamLace(vec2(along * 0.85, s * 1.35 - uTime * 0.16), uTime);
  float breakerFoam = vWaveCrest * (0.32 + 0.68 * uSwellEnergy) * smoothstep(0.30, 0.80, breakerNoise) * 0.68;

  float totalFoam = clamp(
    max(max(edgeFoamMask, rimSpark), max(max(innerBoreMask, trailFoamMask), breakerFoam)),
    0.0,
    1.0
  );
  // Foam dims gracefully toward the far horizon to prevent pixel noise
  totalFoam *= mix(1.0, 0.26, clamp(distCam / 32.0, 0.0, 1.0));

  // Realistic nocturnal foam color (cool starlit slate in New Moon -> bright silver-white in Full Moon)
  vec3 foamLit = starAmbient * 1.55 + moonColor * (0.14 + 0.90 * moonSpecBright);
  // Subtle lunar specular sheen on fresh foam bubbles
  foamLit += moonColor * pow(ndh, 24.0) * 0.28 * moonSpecBright;
  waterColor = mix(waterColor, foamLit, totalFoam * 0.88);

  // Smooth, sub-pixel anti-aliased water-to-sand boundary (zero hard seams!)
  float waterMask = smoothstep(0.0003, 0.0052, waterDepth);
  // Allow delicate dry-edge foam wisps right at the very front of the meniscus
  float lipFoamOverSand = clamp(edgeFoamMask * 0.55, 0.0, 1.0) * (1.0 - waterMask);
  vec3 finalColor = mix(sandColor, waterColor, waterMask);
  finalColor = mix(finalColor, foamLit * 0.85, lipFoamOverSand);

  // Atmospheric night marine haze blending the distant ocean softly into the dark starry horizon
  float horizonBlend = smoothstep(22.0, 104.0, distZ);
  vec3 horizonSky = mix(vec3(0.005, 0.010, 0.022), vec3(0.018, 0.032, 0.056), 0.14 + 0.86 * uMoonIllumination);
  float horizonGlow = exp(-pow((distZ - 58.0) / 30.0, 2.0)) * (0.014 + 0.042 * moonSpecBright);
  finalColor = mix(finalColor, horizonSky, horizonBlend * 0.94) + vec3(0.12, 0.21, 0.36) * horizonGlow;

  // Feather extreme far edge smoothly into skybox so there is never a harsh razor horizon step
  float farAlpha = smoothstep(114.0, 62.0, distZ);
  gl_FragColor = vec4(finalColor, farAlpha * uOpacity);
}
`;

export const sunVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPosition.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const sunFragmentShader = /* glsl */ `
uniform sampler2D uSunMap;
uniform float uTime;
uniform float uOpacity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vec2 uv1 = vec2(fract(vUv.x + uTime * 0.0045), vUv.y);
  vec2 uv2 = vec2(fract(vUv.x - uTime * 0.0028 + 0.37), clamp(vUv.y + sin(uTime * 0.09) * 0.004, 0.001, 0.999));
  vec3 tex = texture2D(uSunMap, uv1).rgb * 0.65 + texture2D(uSunMap, uv2).rgb * 0.35;

  float ndv = max(dot(normalize(vNormal), normalize(vViewDir)), 0.0);
  float limbDarkening = pow(ndv, 0.36);
  float pulse = 1.0 + 0.065 * sin(uTime * 0.62) + 0.032 * sin(uTime * 1.17 + 1.4);
  vec3 coreCol = vec3(2.2, 1.92, 1.48) * pulse;
  vec3 limbCol = vec3(1.35, 0.62, 0.18) * (0.94 + 0.09 * pulse);

  vec3 color = mix(limbCol, coreCol, limbDarkening) * (0.78 + 0.48 * tex);
  // Attenuate HDR disc intensity & soften limb faster than the corona so the Sun melts
  // smoothly into its golden glow without ever leaving a bare white circle; exact 1:1 at uOpacity == 1.0.
  float op = max(uOpacity, 0.0);
  float colorFade = pow(op, 1.4);
  float alphaFade = pow(op, 2.2);
  float edgeSoft = mix(smoothstep(0.02, 0.58, ndv), 1.0, smoothstep(0.65, 1.0, op));
  gl_FragColor = vec4(color * colorFade, alphaFade * edgeSoft);
}
`;

export const sunCoronaVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const sunCoronaFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uTime;

varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  float breathe = 1.0 + 0.13 * sin(uTime * 0.62) + 0.065 * sin(uTime * 1.17 + 1.4);
  float rScaled = r / (0.96 + 0.06 * breathe);

  float core = exp(-rScaled * 8.4) * 2.1 * (0.94 + 0.08 * breathe);
  float innerHalo = exp(-rScaled * 3.35) * 0.74 * breathe;
  float midHalo = exp(-rScaled * 1.85) * 0.26 * breathe;
  float outerHalo = pow(max(1.0 - rScaled, 0.0), 2.75) * 0.2 * breathe;

  // Delicate optical horizontal flare streak
  float streak = exp(-abs(p.y) * 28.0) * exp(-abs(p.x) * 2.15) * 0.24 * breathe;

  float angle = atan(p.y, p.x);
  float rays = 0.9 + 0.1 * sin(angle * 7.0 + uTime * 0.24) * sin(angle * 11.0 - uTime * 0.17);

  vec3 col =
    vec3(1.0, 0.97, 0.9) * core +
    vec3(1.0, 0.78, 0.44) * innerHalo * rays +
    vec3(0.98, 0.56, 0.24) * midHalo +
    vec3(0.82, 0.46, 0.22) * outerHalo +
    vec3(0.88, 0.92, 1.0) * streak;

  // Keep core and golden outer halo fading in lockstep with a gentle perceptual curve
  float baseAlpha = clamp(core + innerHalo + midHalo + outerHalo + streak, 0.0, 1.0);
  float fade = pow(max(uOpacity, 0.0), 1.5);
  gl_FragColor = vec4(col * fade, baseAlpha);
}
`;

export const starfieldVertexShader = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;

uniform float uPixelRatio;
uniform float uTime;
uniform float uSizeScale;
uniform float uHorizonClip;
uniform vec3 uMoonDir;
uniform float uMoonIllum;

varying vec3 vColor;
varying float vTwinkle;

void main() {
  vColor = aColor;
  float speed = 0.85 + fract(aPhase * 0.37) * 1.65;
  float shimmer = 0.62 * sin(uTime * speed + aPhase) + 0.38 * sin(uTime * speed * 1.73 + aPhase * 2.1);

  // In coastal Day mode, apply natural horizon atmospheric extinction and subtle lunar skyglow dimming
  vec3 worldDir = normalize(mat3(modelMatrix) * position);
  float horizonVis = smoothstep(-0.015, 0.09, worldDir.y);
  float moonCos = max(dot(worldDir, normalize(uMoonDir)), 0.0001);
  float nearMoonVeil = 1.0 - pow(moonCos, 28.0) * 0.72 * uMoonIllum;
  // Bright 1st-magnitude stars pierce Full Moon skyglow while faint stars dim realistically
  float faintness = 1.0 - smoothstep(2.1, 4.4, aSize);
  float globalMoonDim = mix(1.0, 0.8, uMoonIllum * (0.24 + 0.76 * faintness));
  float coastalVis = mix(1.0, horizonVis * nearMoonVeil * globalMoonDim, uHorizonClip);

  vTwinkle = (0.8 + 0.24 * shimmer) * coastalVis;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uPixelRatio * uSizeScale, 1.15 * uPixelRatio, 9.5 * uPixelRatio);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const galacticStreamVertexShader = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;

uniform float uPixelRatio;
uniform float uTime;
uniform float uSizeScale;
uniform float uDrift;

varying vec3 vColor;
varying float vTwinkle;

void main() {
  // Wrap each star seamlessly along the [-23, 23] Orion Spur axis so scrubbing years never snaps
  float span = 46.0;
  float along = mod(position.x - uDrift + span * 0.5, span) - span * 0.5;
  float edgeFade = smoothstep(23.0, 17.5, abs(along));

  vec3 pos = vec3(
    along,
    along * 0.34 + position.y,
    position.z + sin(along * 0.14) * 2.2
  );

  vColor = aColor;
  float speed = 0.9 + fract(aPhase * 0.43) * 1.8;
  float shimmer = 0.6 * sin(uTime * speed + aPhase) + 0.4 * sin(uTime * speed * 1.61 + aPhase * 1.9);
  vTwinkle = (0.8 + 0.28 * shimmer) * edgeFade;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = clamp(aSize * uPixelRatio * uSizeScale * (18.0 / max(-mvPosition.z, 1.0)), 1.0, 9.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const starfieldFragmentShader = /* glsl */ `
uniform float uOpacity;

varying vec3 vColor;
varying float vTwinkle;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;

  float core = exp(-r * r * 9.0);
  float halo = exp(-r * 3.0) * 0.35;
  float alpha = (core + halo) * vTwinkle * uOpacity;
  gl_FragColor = vec4(vColor * (core * 1.35 + halo), alpha);
}
`;

export const skyboxVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyboxFragmentShader = /* glsl */ `
uniform sampler2D uSkyMap;
uniform float uBrightness;
uniform float uGamma;
uniform float uGalacticReveal;
uniform float uOpacity;

varying vec2 vUv;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float snoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
    mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * snoise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 raw = texture2D(uSkyMap, vUv).rgb;
  // Suppress low-level JPEG compression floor before lifting dark galactic structure
  vec3 cleanRaw = max(raw - vec3(0.008), vec3(0.0));
  vec3 lifted = pow(cleanRaw, vec3(uGamma));
  vec3 baseSky = lifted * uBrightness;

  float lat = (vUv.y - 0.5) * 3.14159265;
  float lon = (vUv.x - 0.5) * 6.2831853;
  float band = exp(-pow(lat / 0.14, 2.0));
  float wideBand = exp(-pow(lat / 0.28, 2.0));
  float bulge = exp(-pow(lon / 0.48, 2.0)) * exp(-pow(lat / 0.2, 2.0));

  float clouds = fbm(vec2(vUv.x * 16.0, vUv.y * 8.0));
  float fineDust = fbm(vec2(vUv.x * 38.0 + 4.1, vUv.y * 22.0 - 1.7));
  float greatRift = smoothstep(0.36, 0.72, fineDust) * exp(-pow((lat - (clouds - 0.5) * 0.08) / 0.055, 2.0));

  vec3 armColor = mix(vec3(0.16, 0.26, 0.46), vec3(0.52, 0.44, 0.38), clouds);
  vec3 coreColor = vec3(0.95, 0.74, 0.52);

  vec3 nebula = (armColor * wideBand * 0.24 + armColor * band * 0.38 * (0.55 + 0.75 * clouds) + coreColor * bulge * 0.56);
  nebula *= 1.0 - greatRift * 0.76;

  float texLuma = dot(lifted, vec3(0.299, 0.587, 0.114));
  vec3 enhanced = baseSky * (1.0 + uGalacticReveal * 0.85) + nebula * (0.42 + 0.9 * texLuma) * uGalacticReveal;

  gl_FragColor = vec4(enhanced, uOpacity);
}
`;

export const orbitGuideVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const orbitGuideFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uEarthAngle;

varying vec2 vUv;

void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  float fwY = max(length(vec2(dFdx(vUv.y), dFdy(vUv.y))) * 2.0, 0.001);

  float dAngle = mod(vUv.x - uEarthAngle + 3.14159265, 6.2831853) - 3.14159265;
  float absAngle = abs(dAngle);

  // Smoothly dissolve both ends into space, matching the galactic guide's fade behavior
  float arcFade = dAngle < 0.0
    ? smoothstep(1.25, 0.36, absAngle)
    : smoothstep(0.68, 0.22, absAngle);
  if (arcFade < 0.002) discard;

  float hairline = 1.0 - smoothstep(fwY * 0.5, fwY * 1.5, across);

  // Crisp perpendicular engineering graduations: 48 minor ticks (4/month) + 12 major month ticks
  float minorCoord = vUv.x * (48.0 / 6.2831853);
  float fwMinor = max(fwidth(minorCoord), 0.004);
  float minorAntiAlias = smoothstep(0.28, 0.08, fwMinor);
  float minorTick = (1.0 - smoothstep(fwMinor * 0.45, fwMinor * 1.55, abs(fract(minorCoord + 0.5) - 0.5))) *
    (1.0 - smoothstep(0.32, 0.32 + fwY * 1.2, across)) * minorAntiAlias;

  float majorCoord = vUv.x * (12.0 / 6.2831853);
  float fwMajor = max(fwidth(majorCoord), 0.002);
  float majorAntiAlias = smoothstep(0.28, 0.08, fwMajor);
  float majorTick = (1.0 - smoothstep(fwMajor * 0.5, fwMajor * 1.6, abs(fract(majorCoord + 0.5) - 0.5))) *
    (1.0 - smoothstep(0.72, 0.72 + fwY * 1.2, across)) * majorAntiAlias;

  vec3 color = vec3(0.92, 0.94, 0.98);
  float shape = max(hairline * 0.34, max(minorTick * 0.3, majorTick * 0.52));
  float alpha = clamp(shape * arcFade * uOpacity, 0.0, 1.0);
  if (alpha < 0.003) discard;

  gl_FragColor = vec4(color, alpha);
}
`;

export const galacticGuideVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const galacticGuideFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uDrift;

varying vec2 vUv;

void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  float fwY = max(length(vec2(dFdx(vUv.y), dFdy(vUv.y))) * 2.0, 0.001);

  float absAlong = abs(vUv.x);
  float sunClear = smoothstep(0.18, 0.5, absAlong);
  float endFade = smoothstep(5.4, 1.7, absAlong);

  float hairline = 1.0 - smoothstep(fwY * 0.5, fwY * 1.5, across);

  // Crisp perpendicular engineering graduations synced 1:1 with galactic drift (1 tick = 1 year)
  float yearCoord = (vUv.x + uDrift) / 0.36;
  float fwYear = max(fwidth(yearCoord), 0.004);
  float yearAntiAlias = smoothstep(0.28, 0.08, fwYear);
  float yearTick = (1.0 - smoothstep(fwYear * 0.45, fwYear * 1.55, abs(fract(yearCoord + 0.5) - 0.5))) *
    (1.0 - smoothstep(0.32, 0.32 + fwY * 1.2, across)) * yearAntiAlias;

  float decadeCoord = (vUv.x + uDrift) / 3.6;
  float fwDecade = max(fwidth(decadeCoord), 0.002);
  float decadeAntiAlias = smoothstep(0.28, 0.08, fwDecade);
  float decadeTick = (1.0 - smoothstep(fwDecade * 0.5, fwDecade * 1.6, abs(fract(decadeCoord + 0.5) - 0.5))) *
    (1.0 - smoothstep(0.72, 0.72 + fwY * 1.2, across)) * decadeAntiAlias;

  vec3 color = vec3(0.92, 0.94, 0.98);
  float shape = max(hairline * 0.34, max(yearTick * 0.3, decadeTick * 0.52));
  float alpha = clamp(shape * endFade * sunClear * uOpacity, 0.0, 1.0);
  if (alpha < 0.003) discard;

  gl_FragColor = vec4(color, alpha);
}
`;
