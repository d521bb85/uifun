import { type ColorSchemeValue, createColorScheme, createLocalStorage } from "@ui-sdk/core";

export const THEME_ORDER: readonly ColorSchemeValue[] = ["system", "light", "dark"];

export function getNextColorScheme(current: ColorSchemeValue): ColorSchemeValue {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? "system";
}

export const colorScheme = createColorScheme({
  global: true,
  storage: createLocalStorage("theme"),
});
