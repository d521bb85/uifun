export const earthVertexShader = /* glsl */ `
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

export const earthFragmentShader = /* glsl */ `
uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform sampler2D uSpecularMap;
uniform sampler2D uCloudMap;
uniform vec3 uSunDir;
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  float ndotl = dot(N, L);
  float diffuse = max(ndotl, 0.0);
  float dayFactor = smoothstep(-0.16, 0.22, ndotl);
  float twilight = exp(-pow((ndotl + 0.02) / 0.13, 2.0));

  vec3 dayTex = texture2D(uDayMap, vUv).rgb;
  vec3 nightTex = texture2D(uNightMap, vUv).rgb;
  float oceanMask = texture2D(uSpecularMap, vUv).r;

  vec2 cloudUv = vec2(fract(vUv.x + uTime * 0.0025), vUv.y);
  float clouds = texture2D(uCloudMap, cloudUv).r;

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 36.0) * oceanMask * (1.0 - clouds * 0.85) * smoothstep(0.0, 0.25, ndotl);

  vec3 dayColor = dayTex * (0.04 + 1.18 * pow(diffuse, 0.88)) + vec3(0.75, 0.88, 1.0) * spec * 0.42;
  dayColor = mix(dayColor, vec3(0.95, 0.97, 1.0) * (0.06 + 1.08 * diffuse), clouds * 0.78);

  vec3 cityGlow = nightTex * vec3(1.0, 0.78, 0.46) * 1.45 * (1.0 - clouds * 0.65);
  vec3 nightColor = dayTex * 0.022 + cityGlow;

  vec3 color = mix(nightColor, dayColor, dayFactor);

  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.8);
  vec3 scatterBlue = vec3(0.28, 0.58, 1.0);
  vec3 scatterSunset = vec3(0.95, 0.42, 0.18);
  color += scatterSunset * twilight * 0.16 * (0.3 + 0.7 * fresnel);
  color += scatterBlue * fresnel * (0.08 + 0.62 * smoothstep(-0.22, 0.42, ndotl));

  gl_FragColor = vec4(color, 1.0);
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

varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  float viewDot = max(dot(-N, V), 0.0);
  float rim = pow(clamp(1.0 - viewDot, 0.0, 1.0), 4.6);
  float sunSide = smoothstep(-0.25, 0.55, dot(-N, L));
  vec3 glow = mix(vec3(0.18, 0.44, 0.92), vec3(0.45, 0.76, 1.0), sunSide);
  float alpha = rim * sunSide * 0.52;
  gl_FragColor = vec4(glow, alpha);
}
`;

export const moonVertexShader = /* glsl */ `
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

export const moonFragmentShader = /* glsl */ `
uniform sampler2D uMoonMap;
uniform vec3 uSunDir;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  vec3 albedo = texture2D(uMoonMap, vUv).rgb;
  float ndotl = dot(N, L);
  float lit = smoothstep(-0.04, 0.09, ndotl) * max(ndotl, 0.0);
  float earthshine = 0.038;
  vec3 color = albedo * (earthshine + 1.32 * lit);

  float rim = pow(1.0 - max(dot(N, V), 0.0), 4.2);
  color += vec3(0.75, 0.84, 1.0) * rim * 0.08 * smoothstep(-0.2, 0.5, ndotl);

  gl_FragColor = vec4(color, 1.0);
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
  vec2 centered = (vUv - 0.5) * 2.0;
  float r = length(centered);
  if (r > 1.0) discard;

  float core = exp(-r * r * 42.0);
  float innerGlow = exp(-r * 5.0) * 0.72;
  float outerHalo = pow(max(1.0 - r, 0.0), 3.8) * 0.24;
  float anamorphic = exp(-abs(centered.y) * 22.0) * exp(-abs(centered.x) * 3.4) * 0.22;
  float pulse = 0.97 + 0.03 * sin(uTime * 1.1);

  vec3 color = vec3(1.0, 0.98, 0.92) * core * 1.9
    + vec3(1.0, 0.76, 0.38) * (innerGlow + anamorphic) * pulse
    + vec3(0.95, 0.48, 0.20) * outerHalo;

  float alpha = clamp((core + innerGlow * 0.72 + outerHalo + anamorphic) * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

export const helixVertexShader = /* glsl */ `
attribute float aYearOffset;
varying float vYearOffset;

void main() {
  vYearOffset = aYearOffset;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const helixFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uFocusYear;

varying float vYearOffset;

void main() {
  float dist = abs(vYearOffset - uFocusYear);
  float focusFade = exp(-pow(dist / 9.5, 1.55));
  float nearGlow = exp(-pow(dist / 1.3, 2.0));

  float decadeMod = abs(mod(vYearOffset + 5.0, 10.0) - 5.0);
  float decadePulse = smoothstep(0.14, 0.0, decadeMod) * 0.4;

  vec3 baseColor = mix(vec3(0.36, 0.56, 0.92), vec3(0.92, 0.96, 1.0), nearGlow);
  baseColor += vec3(1.0, 0.82, 0.52) * decadePulse * focusFade;

  float alpha = (0.04 + 0.68 * focusFade + 0.28 * nearGlow) * uOpacity;
  if (alpha < 0.008) discard;
  gl_FragColor = vec4(baseColor, alpha);
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
uniform float uIllumination;

varying vec2 vUv;

void main() {
  vec2 centered = (vUv - 0.5) * 2.0;
  float r = length(centered);
  if (r > 1.0) discard;

  float inner = exp(-r * r * 7.5) * (0.14 + 0.42 * uIllumination);
  float outer = pow(max(1.0 - r, 0.0), 3.2) * (0.04 + 0.24 * uIllumination);
  vec3 color = mix(vec3(0.32, 0.46, 0.72), vec3(0.76, 0.86, 1.0), uIllumination);
  float alpha = clamp((inner + outer) * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

export const beachOceanVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const beachOceanFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uIllumination;
uniform float uTideLevel;
uniform float uAspect;
uniform vec2 uMoonUv;

varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm2(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.04 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float waveHeight(vec2 p, float t, float distAtten) {
  float h = 0.0;
  h += sin(p.y * 2.9 + p.x * 0.45 + t * 1.15) * 0.34;
  h += sin(p.y * 5.6 - p.x * 1.15 + t * 1.65) * 0.21;
  h += sin(p.y * 10.4 + p.x * 2.7 + t * 2.2) * 0.11;
  h += (vnoise(vec2(p.x * 2.4 + t * 0.22, p.y * 6.8 + t * 0.95)) - 0.5) * 0.36;
  h += (vnoise(vec2(p.x * 6.2 - t * 0.35, p.y * 14.5 + t * 1.45)) - 0.5) * 0.16;
  return h * distAtten;
}

void main() {
  if (uOpacity < 0.004) discard;

  float horizonY = 0.45;
  vec2 uv = vUv;

  vec3 zenithColor = vec3(0.008, 0.013, 0.028);
  vec3 horizonGlow = mix(vec3(0.022, 0.036, 0.068), vec3(0.075, 0.125, 0.21), uIllumination);

  vec2 moonDelta = (uv - uMoonUv) * vec2(uAspect, 1.0);
  float moonDist = length(moonDelta);
  float skyMoonMist = exp(-moonDist * 3.0) * (0.04 + 0.16 * uIllumination);

  if (uv.y >= horizonY) {
    float skyT = clamp((uv.y - horizonY) / (1.0 - horizonY), 0.0, 1.0);
    vec3 sky = mix(horizonGlow, zenithColor, pow(skyT, 0.58));
    sky += vec3(0.45, 0.62, 0.88) * skyMoonMist;

    // Subtle thin night cirrus clouds catching moonlight
    vec2 cloudCoord = vec2((uv.x - 0.5) * uAspect * 1.8 + uTime * 0.006, (uv.y - horizonY) * 4.5);
    float cloud = smoothstep(0.46, 0.82, fbm2(cloudCoord)) * smoothstep(0.02, 0.32, skyT) * smoothstep(0.95, 0.4, skyT);
    float cloudLit = exp(-moonDist * 2.1) * (0.15 + 0.85 * uIllumination);
    sky += vec3(0.32, 0.44, 0.64) * cloud * (0.04 + 0.22 * cloudLit);

    float skyAlpha = uOpacity * (0.28 + 0.72 * exp(-skyT * 3.8));
    gl_FragColor = vec4(sky, skyAlpha);
    return;
  }

  float dy = max(horizonY - uv.y, 0.0012);
  float z = 0.34 / dy;
  float x = (uv.x - uMoonUv.x) * z * uAspect;
  vec2 worldXZ = vec2(x, z);

  // Spring/neap tide shoreline position + gentle natural wave swash
  float shoreCurve = 0.14 * sin(x * 0.55 + 0.6) + 0.06 * cos(x * 1.15 - 0.4) + (fbm2(vec2(x * 0.9, 1.3)) - 0.5) * 0.11;
  float baseShoreZ = mix(1.78, 0.96, uTideLevel);
  float swashPhase = uTime * 0.95 + sin(x * 0.45) * 0.7;
  float swash = sin(swashPhase) * 0.085 + sin(swashPhase * 0.57 + 1.4) * 0.04;
  float shoreZ = baseShoreZ + shoreCurve + swash;
  float waterDepth = z - shoreZ;

  vec3 moonLightDir = normalize(vec3(0.0, 0.34, 1.0));
  vec3 viewDir = normalize(vec3(-x * 0.75, 1.25, -z));
  float moonPower = 0.12 + 0.88 * uIllumination;

  // Ocean shading
  float distAtten = 1.0 / (1.0 + z * 0.085);
  float shallowAtten = smoothstep(0.0, 0.42, max(waterDepth, 0.0));
  float eps = 0.025 + z * 0.004;
  float hC = waveHeight(worldXZ, uTime, distAtten);
  float hX = waveHeight(worldXZ + vec2(eps, 0.0), uTime, distAtten);
  float hZ = waveHeight(worldXZ + vec2(0.0, eps), uTime, distAtten);
  float slopeScale = (0.14 + 0.24 * shallowAtten);
  vec3 N_water = normalize(vec3((hC - hX) / eps * slopeScale, 1.0, (hC - hZ) / eps * slopeScale));

  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N_water, viewDir), 0.0), 4.6);
  vec3 deepWater = mix(vec3(0.006, 0.014, 0.028), vec3(0.014, 0.032, 0.062), uIllumination);
  vec3 skyReflect = mix(horizonGlow, zenithColor, 0.35);
  vec3 waterColor = mix(deepWater, skyReflect, fresnel * 0.85);

  vec3 H = normalize(moonLightDir + viewDir);
  float ndoth = max(dot(N_water, H), 0.0);
  float specTight = pow(ndoth, 240.0) * 2.6;
  float specBroad = pow(ndoth, 26.0) * 0.32;
  float pathMask = exp(-abs(x) * (0.48 / (1.0 + z * 0.16)));
  vec3 moonTint = mix(vec3(0.58, 0.72, 0.94), vec3(0.88, 0.93, 1.0), uIllumination);
  waterColor += moonTint * (specTight + specBroad * pathMask) * moonPower;

  // Lacy breaking surf foam along the waterline and incoming wave crest
  float foamNoise = fbm2(vec2(x * 3.8 + uTime * 0.12, (z - shoreZ) * 9.5 + uTime * 0.45));
  float edgeFoam = exp(-max(waterDepth, 0.0) * 14.0) * smoothstep(0.32, 0.72, foamNoise + 0.18);
  float thinLip = exp(-abs(waterDepth) * 44.0) * (0.45 + 0.55 * foamNoise);
  float waveCrestPos = 0.52 + 0.18 * sin(uTime * 0.95 - 1.1);
  float secondaryFoam = exp(-pow((waterDepth - waveCrestPos) * 7.5, 2.0)) * smoothstep(0.45, 0.82, foamNoise) * 0.48;
  float foamMask = clamp(edgeFoam * 0.72 + thinLip * 0.65 + secondaryFoam, 0.0, 1.0);
  vec3 foamColor = mix(vec3(0.14, 0.19, 0.28), vec3(0.68, 0.77, 0.90), uIllumination) * (0.55 + 0.45 * pathMask);
  waterColor = mix(waterColor, foamColor, foamMask);

  // Horizon atmospheric fog blend on water
  float horizonFog = exp(-dy * 34.0);
  waterColor = mix(waterColor, horizonGlow + vec3(0.35, 0.5, 0.75) * skyMoonMist, horizonFog);

  // Beach sand shading (glistening wet sand near waterline -> dark matte dry sand at bottom)
  float highWaterMark = 0.90 + shoreCurve;
  float sandGrain = fbm2(vec2(x * 16.0, z * 22.0));
  float microGrain = vnoise(vec2(x * 65.0, z * 85.0));
  float wetness = smoothstep(-0.55, 0.04, waterDepth) * 0.75 + smoothstep(highWaterMark - 0.28, highWaterMark + 0.12, z) * 0.45;
  wetness = clamp(wetness, 0.0, 1.0);

  vec3 drySand = vec3(0.022, 0.025, 0.034) * (0.85 + 0.3 * sandGrain) * (0.7 + 0.45 * uIllumination);
  vec3 wetSand = vec3(0.012, 0.017, 0.028) * (0.9 + 0.2 * microGrain);
  vec3 sandColor = mix(drySand, wetSand, wetness);

  // Mirror-like moonlight sheen on wet sand
  vec3 N_sand = normalize(vec3((sandGrain - 0.5) * 0.09, 1.0, (microGrain - 0.5) * 0.09));
  float sandSpec = pow(max(dot(N_sand, H), 0.0), 38.0) * wetness * moonPower;
  float wetPath = exp(-abs(x) * 0.62);
  sandColor += moonTint * (sandSpec * 0.52 + 0.08 * wetPath * wetness * moonPower);

  // Blend ocean smoothly into wet sand along the dynamic waterline
  float waterBlend = smoothstep(-0.025, 0.035, waterDepth);
  vec3 finalGround = mix(sandColor, waterColor, waterBlend);
  finalGround += foamColor * thinLip * 0.45 * (1.0 - waterBlend);

  // Subtle bottom vignette so the date in the lower-right stays razor sharp
  float bottomVignette = smoothstep(0.0, 0.18, uv.y);
  finalGround *= 0.62 + 0.38 * bottomVignette;

  gl_FragColor = vec4(finalGround, uOpacity);
}
`;
