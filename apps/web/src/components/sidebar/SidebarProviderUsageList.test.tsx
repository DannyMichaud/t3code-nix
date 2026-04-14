import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarProviderUsageList } from "./SidebarProviderUsageList";

describe("SidebarProviderUsageList", () => {
  it("renders one usage row per eligible provider above the settings area", () => {
    const markup = renderToStaticMarkup(
      <SidebarProviderUsageList
        providers={[
          {
            provider: "codex",
            enabled: true,
            installed: true,
            version: "0.116.0",
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt: "2026-04-08T00:00:00.000Z",
            models: [],
            usageLimits: {
              updatedAt: "2026-04-08T00:00:00.000Z",
              windows: [{ label: "5h", durationMinutes: 300, usedPercent: 42 }],
            },
          },
          {
            provider: "claudeAgent",
            enabled: true,
            installed: true,
            version: "1.0.0",
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt: "2026-04-08T00:00:00.000Z",
            models: [],
            usageLimits: {
              updatedAt: "2026-04-08T00:00:00.000Z",
              windows: [{ label: "7d", durationMinutes: 10_080 }],
            },
          },
          {
            provider: "codex",
            enabled: false,
            installed: true,
            version: "0.116.0",
            status: "disabled",
            auth: { status: "authenticated" },
            checkedAt: "2026-04-08T00:00:00.000Z",
            models: [],
            usageLimits: {
              updatedAt: "2026-04-08T00:00:00.000Z",
              windows: [{ label: "5h", durationMinutes: 300, usedPercent: 99 }],
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("sidebar-provider-usage-list");
    expect(markup).toContain("sidebar-provider-usage-row-codex");
    expect(markup).toContain("sidebar-provider-usage-row-claudeAgent");
    expect(markup).toContain("Codex");
    expect(markup).toContain("Claude");
    expect(markup).toContain("42%");
    expect(markup).toContain("n/a");
    expect(markup).not.toContain("99%");
  });

  it("renders nothing when no providers are eligible", () => {
    expect(
      renderToStaticMarkup(
        <SidebarProviderUsageList
          providers={[
            {
              provider: "codex",
              enabled: true,
              installed: true,
              version: "0.116.0",
              status: "ready",
              auth: { status: "unknown" },
              checkedAt: "2026-04-08T00:00:00.000Z",
              models: [],
              usageLimits: {
                updatedAt: "2026-04-08T00:00:00.000Z",
                windows: [{ label: "5h", durationMinutes: 300, usedPercent: 42 }],
              },
            },
          ]}
        />,
      ),
    ).toBe("");
  });
});
