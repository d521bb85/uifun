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

  vec3 localTangent = normalize(vec3(-sin(uv.x * 6.2831853), 0.0, cos(uv.x * 6.2831853)));
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
  vec3 twilightTint = vec3(0.95, 0.42, 0.18) * terminatorBand * 0.11 * (1.0 - cloudDensity * 0.4);

  float limbScatter = pow(1.0 - ndv, 3.1) * smoothstep(-0.14, 0.3, ndl);
  vec3 rayleigh = vec3(0.24, 0.6, 1.0) * limbScatter * 0.72;

  float nightFactor = smoothstep(0.05, -0.18, ndl);
  vec3 cityGlow = nightLights * vec3(1.0, 0.8, 0.48) * nightFactor * (1.0 - cloudDensity * 0.62) * 1.85;
  vec3 nightAmbient = dayColor * vec3(0.015, 0.025, 0.052) * nightFactor;

  vec3 color = mix(nightAmbient + cityGlow, litDay + oceanSpec + oceanFresnel, dayFactor) + twilightTint + rayleigh;
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
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);

  float lit = smoothstep(-0.1, 0.24, ndl);
  float sunset = exp(-pow((ndl + 0.01) / 0.055, 2.0));
  vec3 dayCol = vec3(0.97, 0.99, 1.0) * (0.24 + 0.95 * pow(max(ndl, 0.0), 0.78));
  vec3 sunsetCol = vec3(1.0, 0.56, 0.28) * sunset * 0.16;
  vec3 nightCol = vec3(0.014, 0.022, 0.044);

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
  float rim = pow(clamp(1.0 - viewDot, 0.0, 1.0), 3.4);
  float outerFalloff = smoothstep(0.0, 0.36, viewDot);

  float ndl = dot(N, L);
  float sunMask = smoothstep(-0.26, 0.36, ndl);
  float sunsetBand = exp(-pow((ndl + 0.02) / 0.12, 2.0));

  vec3 dayHalo = vec3(0.24, 0.62, 1.0);
  vec3 sunsetHalo = vec3(0.95, 0.48, 0.24);
  vec3 color = mix(dayHalo, sunsetHalo, sunsetBand * 0.25);

  float intensity = rim * outerFalloff * (0.05 + 0.95 * sunMask) * 1.45;
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

  vec3 localTangent = normalize(vec3(-sin(uv.x * 6.2831853), 0.0, cos(uv.x * 6.2831853)));
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

export const oceanVertexShader = /* glsl */ `
uniform float uTime;
uniform float uWaterLevel;
uniform float uSwellEnergy;

varying vec3 vWorldPos;
varying vec2 vUv;
varying float vWaveHeight;

void main() {
  vUv = uv;
  vec3 pos = position;

  float distZ = max(0.0, -pos.z);
  float horizonCurve = -0.0014 * (pos.x * pos.x) - 0.0008 * (distZ * distZ);

  float amp = 0.018 + 0.042 * uSwellEnergy;
  float w1 = sin(pos.x * 0.85 + pos.z * 0.62 + uTime * 0.9) * amp;
  float w2 = sin(pos.x * -1.42 + pos.z * 1.18 + uTime * 1.25) * (amp * 0.5);
  float w3 = cos(pos.x * 2.45 - pos.z * 1.95 + uTime * 1.65) * (amp * 0.24);

  float nearFade = smoothstep(24.0, 2.5, distZ);
  float tideOffset = uWaterLevel * 0.34;
  float wave = (w1 + w2 + w3) * nearFade;

  pos.y += tideOffset + horizonCurve + wave;
  vWaveHeight = wave;

  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const oceanFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uMoonDir;
uniform float uMoonIllumination;
uniform float uSwellEnergy;
uniform float uWaterLevel;
uniform float uOpacity;

varying vec3 vWorldPos;
varying vec2 vUv;
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

// Fine anisotropic ocean ripples stretched horizontally like wind-driven sea swells
float waveField(vec2 p, float t) {
  vec2 a = vec2(p.x * 0.72, p.y * 1.55);
  float h = 0.0;
  h += noise(a * 0.95 + vec2(t * 0.18, -t * 0.24)) * 0.44;
  h += noise(a * 2.35 + vec2(-t * 0.28, t * 0.36)) * 0.28;
  h += noise(a * 5.6 + vec2(t * 0.44, t * 0.58)) * 0.16;
  h += noise(a * 12.8 + vec2(-t * 0.64, -t * 0.82)) * 0.08;
  h += noise(a * 26.0 + vec2(t * 0.85, -t * 1.1)) * 0.04;
  return h;
}

void main() {
  vec2 p = vWorldPos.xz;
  float dist = length(cameraPosition - vWorldPos);
  float eps = mix(0.032, 0.095, clamp(dist / 22.0, 0.0, 1.0));

  float h0 = waveField(p, uTime);
  float hx = waveField(p + vec2(eps, 0.0), uTime);
  float hz = waveField(p + vec2(0.0, eps), uTime);

  float choppiness = (0.16 + 0.2 * uSwellEnergy) * mix(1.0, 0.55, clamp(dist / 20.0, 0.0, 1.0));
  vec3 N = normalize(vec3((h0 - hx) / eps * choppiness, 1.0, (h0 - hz) / eps * choppiness));
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uMoonDir);

  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.6);

  vec3 deepWater = vec3(0.006, 0.015, 0.034);
  vec3 skyReflect = mix(vec3(0.022, 0.048, 0.098), vec3(0.11, 0.17, 0.29), 0.18 + 0.82 * uMoonIllumination);
  vec3 color = mix(deepWater, skyReflect, clamp(fresnel * 0.85, 0.0, 1.0));

  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float moonBright = 0.06 + 0.94 * pow(uMoonIllumination, 0.9);
  float glitterPin = pow(ndh, 420.0) * 2.8;
  float glitterMid = pow(ndh, 78.0) * 0.55;
  float glitterWide = pow(ndh, 16.0) * 0.1;
  vec3 moonColor = vec3(0.86, 0.92, 1.0);
  color += moonColor * (glitterPin + glitterMid + glitterWide) * moonBright;

  float crest = smoothstep(0.022, 0.056, vWaveHeight) * uSwellEnergy * (0.3 + 0.7 * moonBright);
  color += vec3(0.18, 0.28, 0.44) * crest * 0.28;

  float horizonFade = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
  float edgeFade = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  float horizonMist = exp(-pow((vUv.y - 0.84) / 0.11, 2.0)) * (0.04 + 0.09 * moonBright + 0.05 * (uWaterLevel * 0.5 + 0.5));
  color += vec3(0.16, 0.28, 0.48) * horizonMist;

  gl_FragColor = vec4(color, horizonFade * edgeFade * uOpacity);
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
  vec2 uv1 = vec2(fract(vUv.x + uTime * 0.004), vUv.y);
  vec2 uv2 = vec2(fract(vUv.x - uTime * 0.0025 + 0.37), clamp(vUv.y + sin(uTime * 0.08) * 0.004, 0.001, 0.999));
  vec3 tex = texture2D(uSunMap, uv1).rgb * 0.65 + texture2D(uSunMap, uv2).rgb * 0.35;

  float ndv = max(dot(normalize(vNormal), normalize(vViewDir)), 0.0);
  float limbDarkening = pow(ndv, 0.36);
  vec3 coreCol = vec3(2.2, 1.92, 1.48);
  vec3 limbCol = vec3(1.35, 0.62, 0.18);

  vec3 color = mix(limbCol, coreCol, limbDarkening) * (0.78 + 0.48 * tex);
  gl_FragColor = vec4(color, uOpacity);
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

  float core = exp(-r * 8.5) * 2.1;
  float innerHalo = exp(-r * 3.4) * 0.72;
  float midHalo = exp(-r * 1.9) * 0.24;
  float outerHalo = pow(max(1.0 - r, 0.0), 2.8) * 0.18;

  // Delicate optical horizontal flare streak
  float streak = exp(-abs(p.y) * 28.0) * exp(-abs(p.x) * 2.2) * 0.22;

  float angle = atan(p.y, p.x);
  float rays = 0.92 + 0.08 * sin(angle * 7.0 + uTime * 0.22) * sin(angle * 11.0 - uTime * 0.16);

  vec3 col =
    vec3(1.0, 0.97, 0.9) * core +
    vec3(1.0, 0.78, 0.44) * innerHalo * rays +
    vec3(0.98, 0.56, 0.24) * midHalo +
    vec3(0.82, 0.46, 0.22) * outerHalo +
    vec3(0.88, 0.92, 1.0) * streak;

  float alpha = clamp((core + innerHalo + midHalo + outerHalo + streak) * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(col * uOpacity, alpha);
}
`;

export const starfieldVertexShader = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;

uniform float uPixelRatio;
uniform float uTime;
uniform float uSizeScale;

varying vec3 vColor;
varying float vTwinkle;

void main() {
  vColor = aColor;
  vTwinkle = 0.88 + 0.12 * sin(uTime * 1.1 + aPhase);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
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

  gl_FragColor = vec4(enhanced, 1.0);
}
`;
