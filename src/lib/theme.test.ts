import { afterEach, describe, expect, it } from "vitest";
import { colorScheme, getNextColorScheme } from "./theme";

describe("colorScheme preference", () => {
  afterEach(() => {
    colorScheme.set("system");
  });

  it("defaults to system and switches between light, dark, and system", () => {
    expect(colorScheme.defaultValue).toBe("system");
    expect(colorScheme.global).toBe(true);
    expect(colorScheme.get().value).toBe("system");

    expect(colorScheme.set("dark")).toBe(true);
    expect(colorScheme.get().value).toBe("dark");
    expect(colorScheme.get().resolved).toBe("dark");

    expect(colorScheme.set("light")).toBe(true);
    expect(colorScheme.get().value).toBe("light");
    expect(colorScheme.get().resolved).toBe("light");

    expect(colorScheme.set("system")).toBe(true);
    expect(colorScheme.get().value).toBe("system");
  });

  it("cycles theme order system -> light -> dark -> system", () => {
    expect(getNextColorScheme("system")).toBe("light");
    expect(getNextColorScheme("light")).toBe("dark");
    expect(getNextColorScheme("dark")).toBe("system");
  });
});
