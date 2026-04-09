import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UsageLimitsWidget } from "./UsageLimitsWidget";

describe("UsageLimitsWidget", () => {
  it("renders both canonical pills when both windows exist", () => {
    const markup = renderToStaticMarkup(
      <UsageLimitsWidget
        usageLimits={{
          updatedAt: "2026-04-08T00:00:00.000Z",
          windows: [
            {
              label: "5h",
              durationMinutes: 300,
              usedPercent: 42,
            },
            {
              label: "7d",
              durationMinutes: 10_080,
              usedPercent: 18,
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("usage-limit-pill-5h");
    expect(markup).toContain("usage-limit-pill-7d");
    expect(markup).toContain("5h");
    expect(markup).toContain("42%");
    expect(markup).toContain("7d");
    expect(markup).toContain("18%");
  });

  it("renders a single canonical pill when only one window exists", () => {
    const markup = renderToStaticMarkup(
      <UsageLimitsWidget
        usageLimits={{
          updatedAt: "2026-04-08T00:00:00.000Z",
          windows: [
            {
              label: "7d",
              durationMinutes: 10_080,
              usedPercent: 18,
            },
          ],
        }}
      />,
    );

    expect(markup).not.toContain("usage-limit-pill-5h");
    expect(markup).toContain("usage-limit-pill-7d");
  });

  it("hides the widget when no supported windows exist", () => {
    expect(
      renderToStaticMarkup(
        <UsageLimitsWidget
          usageLimits={{
            updatedAt: "2026-04-08T00:00:00.000Z",
            windows: [
              {
                label: "30d",
                durationMinutes: 43_200,
                usedPercent: 4,
              },
            ],
          }}
        />,
      ),
    ).toBe("");
  });
});
