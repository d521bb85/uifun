import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AstroDatePicker } from "./AstroDatePicker";
import { AstroDatePickerSkeleton } from "./AstroDatePickerSkeleton";

describe("AstroDatePicker", () => {
  it("renders cleanly during SSR with default and custom props without browser globals", () => {
    const html = renderToString(
      <AstroDatePicker
        label="Birthday"
        defaultValue="1995-02-16"
        name="birthday"
        locale="en-US"
        className="custom-card"
      />,
    );

    expect(html).toContain("Birthday");
    expect(html).toContain("<canvas");
    expect(html).toContain('data-focus-mode="idle"');
    expect(html).toContain("custom-card");
    expect(html).toContain('data-type="month"');
    expect(html).toContain('data-type="day"');
    expect(html).toContain('data-type="year"');
    expect(html).toContain('value="02"');
    expect(html).toContain('value="16"');
    expect(html).toContain('value="1995"');
    // Standard date-picker semantics: mobile numeric keypad, ARIA spinbuttons, hidden form input
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="birthday"');
    expect(html).toContain('value="1995-02-16"');
  });

  it("supports controlled values, disabled, readOnly, required, and different locales", () => {
    const html = renderToString(
      <AstroDatePicker
        label="Datum"
        value="2026-11-24"
        locale="de-DE"
        form="booking-form"
        disabled
        readOnly
        required
      />,
    );

    expect(html).toContain("Datum");
    expect(html).toContain("data-disabled");
    expect(html).toContain('value="24"');
    expect(html).toContain('value="11"');
    expect(html).toContain('value="2026"');
    // German locale orders day before month before year
    const dayIdx = html.indexOf('data-type="day"');
    const monthIdx = html.indexOf('data-type="month"');
    const yearIdx = html.indexOf('data-type="year"');
    expect(dayIdx).toBeGreaterThan(-1);
    expect(dayIdx).toBeLessThan(monthIdx);
    expect(monthIdx).toBeLessThan(yearIdx);
  });

  it("handles controlled null value gracefully without crashing", () => {
    const html = renderToString(<AstroDatePicker label="Empty date" value={null} />);
    expect(html).toContain("Empty date");
    expect(html).toContain("<canvas");
    expect(html).toContain("data-assets-loading");
    expect(html).toContain("data-astro-skeleton");
  });

  it("renders a control-shaped standalone skeleton cleanly during SSR", () => {
    const html = renderToString(<AstroDatePickerSkeleton className="custom-skeleton" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("custom-skeleton");
    expect(html).toContain("data-astro-skeleton");
  });
});
