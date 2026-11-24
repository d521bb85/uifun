export interface StarEntry {
  raHours: number;
  decDeg: number;
  mag: number;
  bv: number;
}

// Brightest Hipparcos J2000 stars (RA hours, Dec deg, Vmag, B-V color index)
export const BRIGHT_STARS: readonly StarEntry[] = [
  { raHours: 6.7525, decDeg: -16.7161, mag: -1.46, bv: 0.0 },
  { raHours: 6.3992, decDeg: -52.6957, mag: -0.74, bv: 0.15 },
  { raHours: 14.6601, decDeg: -60.8339, mag: -0.27, bv: 0.71 },
  { raHours: 14.261, decDeg: 19.1825, mag: -0.05, bv: 1.23 },
  { raHours: 18.6156, decDeg: 38.7837, mag: 0.03, bv: 0.0 },
  { raHours: 5.2782, decDeg: 45.998, mag: 0.08, bv: 0.8 },
  { raHours: 5.2423, decDeg: -8.2016, mag: 0.13, bv: -0.03 },
  { raHours: 7.655, decDeg: 5.225, mag: 0.34, bv: 0.42 },
  { raHours: 1.6286, decDeg: -57.2368, mag: 0.46, bv: -0.16 },
  { raHours: 5.9195, decDeg: 7.4071, mag: 0.5, bv: 1.85 },
  { raHours: 14.0637, decDeg: -60.373, mag: 0.61, bv: -0.23 },
  { raHours: 19.8464, decDeg: 8.8683, mag: 0.76, bv: 0.22 },
  { raHours: 12.4433, decDeg: -63.0991, mag: 0.77, bv: -0.24 },
  { raHours: 4.5987, decDeg: 16.5093, mag: 0.86, bv: 1.54 },
  { raHours: 16.4901, decDeg: -26.432, mag: 0.96, bv: 1.83 },
  { raHours: 13.4199, decDeg: -11.1614, mag: 0.97, bv: -0.23 },
  { raHours: 7.7553, decDeg: 28.0262, mag: 1.14, bv: 1.0 },
  { raHours: 22.9608, decDeg: -29.6222, mag: 1.16, bv: 0.09 },
  { raHours: 20.6905, decDeg: 45.2803, mag: 1.25, bv: 0.09 },
  { raHours: 12.7954, decDeg: -59.6888, mag: 1.25, bv: -0.23 },
  { raHours: 10.1395, decDeg: 11.9672, mag: 1.35, bv: -0.11 },
  { raHours: 6.9771, decDeg: -28.9721, mag: 1.5, bv: -0.21 },
  { raHours: 7.5767, decDeg: 31.8883, mag: 1.58, bv: 0.03 },
  { raHours: 17.5601, decDeg: -37.1038, mag: 1.62, bv: -0.22 },
  { raHours: 5.4189, decDeg: 6.3497, mag: 1.64, bv: -0.22 },
  { raHours: 5.4382, decDeg: 28.6074, mag: 1.65, bv: -0.13 },
  { raHours: 9.22, decDeg: -69.7172, mag: 1.67, bv: 0.0 },
  { raHours: 5.6036, decDeg: -1.2019, mag: 1.69, bv: -0.18 },
  { raHours: 22.1372, decDeg: -46.9609, mag: 1.74, bv: -0.13 },
  { raHours: 12.9005, decDeg: 55.9598, mag: 1.76, bv: -0.02 },
  { raHours: 8.1589, decDeg: -47.3366, mag: 1.78, bv: -0.22 },
  { raHours: 11.0621, decDeg: 61.751, mag: 1.79, bv: 1.07 },
  { raHours: 3.4054, decDeg: 49.8612, mag: 1.79, bv: 0.48 },
  { raHours: 18.4029, decDeg: -34.3846, mag: 1.8, bv: -0.03 },
  { raHours: 7.1399, decDeg: -26.3932, mag: 1.83, bv: 0.67 },
  { raHours: 13.7923, decDeg: 49.3133, mag: 1.85, bv: -0.19 },
  { raHours: 17.622, decDeg: -42.9978, mag: 1.86, bv: 0.4 },
  { raHours: 5.6793, decDeg: -1.9426, mag: 1.88, bv: -0.21 },
  { raHours: 8.3752, decDeg: -59.5095, mag: 1.86, bv: 1.28 },
  { raHours: 6.6285, decDeg: 16.3993, mag: 1.93, bv: 0.0 },
  { raHours: 16.8111, decDeg: -69.0277, mag: 1.91, bv: 1.44 },
  { raHours: 20.4275, decDeg: -56.7351, mag: 1.94, bv: -0.2 },
  { raHours: 8.745, decDeg: -54.7088, mag: 1.96, bv: 0.04 },
  { raHours: 6.3783, decDeg: -17.9559, mag: 1.98, bv: -0.23 },
  { raHours: 9.4598, decDeg: -8.6586, mag: 1.98, bv: 1.44 },
  { raHours: 2.1196, decDeg: 23.4624, mag: 2.01, bv: 1.15 },
  { raHours: 2.5303, decDeg: 89.2641, mag: 2.02, bv: 0.6 },
  { raHours: 10.3329, decDeg: 19.8415, mag: 2.01, bv: 1.13 },
  { raHours: 0.7265, decDeg: -17.9866, mag: 2.04, bv: 1.02 },
  { raHours: 18.9211, decDeg: -26.2967, mag: 2.05, bv: -0.2 },
  { raHours: 0.1398, decDeg: 29.0904, mag: 2.06, bv: -0.11 },
  { raHours: 1.1622, decDeg: 35.6206, mag: 2.06, bv: 1.58 },
  { raHours: 5.7959, decDeg: -9.6696, mag: 2.06, bv: -0.17 },
  { raHours: 14.8451, decDeg: 74.1555, mag: 2.07, bv: 1.47 },
  { raHours: 17.5822, decDeg: 12.56, mag: 2.08, bv: 0.15 },
  { raHours: 3.1361, decDeg: 40.9556, mag: 2.12, bv: -0.05 },
  { raHours: 11.8177, decDeg: 14.5721, mag: 2.14, bv: 0.09 },
  { raHours: 2.065, decDeg: 42.3297, mag: 2.1, bv: 1.37 },
  { raHours: 13.3988, decDeg: 54.9254, mag: 2.23, bv: 0.02 },
  { raHours: 0.6751, decDeg: 56.5373, mag: 2.23, bv: 1.17 },
  { raHours: 15.5781, decDeg: 26.7147, mag: 2.22, bv: -0.02 },
  { raHours: 20.3705, decDeg: 40.2567, mag: 2.23, bv: 0.67 },
  { raHours: 17.9434, decDeg: 51.4889, mag: 2.24, bv: 1.52 },
  { raHours: 5.5334, decDeg: -0.2991, mag: 2.25, bv: -0.22 },
  { raHours: 0.1529, decDeg: 59.1498, mag: 2.28, bv: 0.34 },
  { raHours: 11.0307, decDeg: 56.3824, mag: 2.37, bv: -0.02 },
  { raHours: 11.8972, decDeg: 53.6948, mag: 2.44, bv: 0.0 },
  { raHours: 21.7364, decDeg: 9.875, mag: 2.38, bv: 1.52 },
  { raHours: 23.0629, decDeg: 28.0828, mag: 2.42, bv: 1.67 },
  { raHours: 23.0793, decDeg: 15.2053, mag: 2.49, bv: -0.04 },
  { raHours: 21.3096, decDeg: 62.5856, mag: 2.45, bv: 0.22 },
  { raHours: 0.9451, decDeg: 60.7167, mag: 2.47, bv: -0.15 },
  { raHours: 1.4303, decDeg: 60.2353, mag: 2.68, bv: 0.13 },
  { raHours: 16.0056, decDeg: -22.6217, mag: 2.29, bv: -0.12 },
  { raHours: 16.8361, decDeg: -34.2932, mag: 2.29, bv: 1.15 },
  { raHours: 14.1114, decDeg: -36.37, mag: 2.06, bv: 1.01 },
  { raHours: 14.5917, decDeg: -42.1578, mag: 2.31, bv: -0.22 },
  { raHours: 15.2833, decDeg: -9.3829, mag: 2.61, bv: -0.11 },
  { raHours: 14.848, decDeg: -16.0418, mag: 2.75, bv: 0.15 },
  { raHours: 12.257, decDeg: 57.0326, mag: 3.31, bv: 0.08 },
  { raHours: 19.512, decDeg: 27.9597, mag: 3.05, bv: 1.13 },
  { raHours: 20.7703, decDeg: 33.9703, mag: 2.48, bv: 1.03 },
  { raHours: 19.7496, decDeg: 45.1308, mag: 2.87, bv: -0.03 },
  { raHours: 18.9822, decDeg: 32.6896, mag: 3.25, bv: -0.05 },
  { raHours: 18.8347, decDeg: 33.3627, mag: 3.52, bv: 0.0 },
  { raHours: 3.7914, decDeg: 24.1051, mag: 2.87, bv: -0.09 },
  { raHours: 5.9921, decDeg: 44.9474, mag: 1.9, bv: 0.03 },
  { raHours: 4.9499, decDeg: 33.1663, mag: 2.69, bv: 1.53 },
  { raHours: 5.9951, decDeg: 37.2126, mag: 2.65, bv: -0.08 },
  { raHours: 3.038, decDeg: 4.0897, mag: 2.54, bv: 1.64 },
  { raHours: 2.7217, decDeg: 3.2367, mag: 3.47, bv: 0.09 },
  { raHours: 15.7378, decDeg: 6.4256, mag: 2.63, bv: 1.17 },
  { raHours: 16.5038, decDeg: 21.4896, mag: 2.78, bv: 0.94 },
  { raHours: 16.6881, decDeg: 31.6027, mag: 2.81, bv: 0.65 },
  { raHours: 17.2442, decDeg: 14.3903, mag: 3.06, bv: 1.44 },
  { raHours: 17.173, decDeg: -15.7249, mag: 2.43, bv: 0.06 },
  { raHours: 17.7245, decDeg: 4.5673, mag: 2.77, bv: 1.16 },
  { raHours: 16.3531, decDeg: -4.6925, mag: 2.73, bv: 1.58 },
  { raHours: 17.5072, decDeg: 52.3014, mag: 2.79, bv: 0.98 },
  { raHours: 16.3997, decDeg: 61.5142, mag: 2.73, bv: 0.91 },
  { raHours: 14.0731, decDeg: 64.3758, mag: 3.67, bv: -0.05 },
  { raHours: 12.9338, decDeg: 38.3184, mag: 2.89, bv: -0.06 },
  { raHours: 14.7498, decDeg: 27.0742, mag: 2.35, bv: 0.97 },
  { raHours: 13.9114, decDeg: 18.3977, mag: 2.68, bv: 0.58 },
  { raHours: 14.5349, decDeg: 38.3083, mag: 3.04, bv: 0.19 },
  { raHours: 11.2351, decDeg: 20.5237, mag: 2.56, bv: 0.12 },
  { raHours: 10.333, decDeg: 23.4173, mag: 3.44, bv: 0.31 },
  { raHours: 9.7642, decDeg: 23.7743, mag: 2.97, bv: 0.81 },
  { raHours: 13.0363, decDeg: 10.9591, mag: 2.85, bv: 0.94 },
  { raHours: 12.6943, decDeg: -1.4494, mag: 2.74, bv: 0.36 },
  { raHours: 12.4964, decDeg: -16.5154, mag: 2.58, bv: -0.11 },
  { raHours: 12.5733, decDeg: -23.3968, mag: 2.65, bv: 0.89 },
  { raHours: 10.7159, decDeg: -64.3944, mag: 2.74, bv: -0.22 },
  { raHours: 9.285, decDeg: -59.2752, mag: 2.21, bv: 0.18 },
  { raHours: 10.8975, decDeg: -58.8533, mag: 2.69, bv: 1.66 },
  { raHours: 8.7867, decDeg: -54.7088, mag: 1.96, bv: 0.04 },
  { raHours: 9.1333, decDeg: -43.4326, mag: 2.23, bv: 1.66 },
  { raHours: 18.4664, decDeg: -25.4217, mag: 2.82, bv: 1.04 },
  { raHours: 19.0436, decDeg: -29.8801, mag: 2.6, bv: 0.08 },
  { raHours: 19.1628, decDeg: -21.0236, mag: 2.88, bv: 0.35 },
  { raHours: 20.3503, decDeg: -14.7815, mag: 3.05, bv: 0.79 },
  { raHours: 21.7842, decDeg: -16.1273, mag: 2.85, bv: 0.29 },
  { raHours: 22.0964, decDeg: -0.3199, mag: 2.95, bv: 0.97 },
  { raHours: 21.526, decDeg: -5.5712, mag: 2.9, bv: 0.83 },
  { raHours: 22.7112, decDeg: -46.8846, mag: 2.11, bv: 1.6 },
  { raHours: 0.4381, decDeg: -42.306, mag: 2.4, bv: 1.09 },
  { raHours: 2.971, decDeg: -40.3047, mag: 2.91, bv: 0.13 },
  { raHours: 5.1308, decDeg: -5.0864, mag: 2.78, bv: 0.13 },
  { raHours: 5.4708, decDeg: -17.8223, mag: 2.81, bv: 0.82 },
  { raHours: 5.5455, decDeg: -20.7594, mag: 2.58, bv: 0.21 },
];

export function bvToRgb(bv: number): [number, number, number] {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  let r = 1;
  let g = 1;
  let b = 1;

  if (t < 0.0) {
    r = 0.62 + 0.38 * ((t + 0.4) / 0.4);
    g = 0.76 + 0.24 * ((t + 0.4) / 0.4);
    b = 1.0;
  } else if (t < 0.4) {
    r = 0.88 + 0.12 * (t / 0.4);
    g = 0.92 + 0.06 * (t / 0.4);
    b = 1.0 - 0.08 * (t / 0.4);
  } else if (t < 1.0) {
    r = 1.0;
    g = 0.98 - 0.18 * ((t - 0.4) / 0.6);
    b = 0.92 - 0.38 * ((t - 0.4) / 0.6);
  } else {
    r = 1.0;
    g = 0.8 - 0.32 * ((t - 1.0) / 1.0);
    b = 0.54 - 0.34 * ((t - 1.0) / 1.0);
  }

  return [r, g, b];
}
