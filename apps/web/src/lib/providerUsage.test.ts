import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { getCanonicalProviderUsageWindows, getSidebarProviderUsageEntries } from "./providerUsage";

describe("providerUsage", () => {
  it("returns canonical 5h and 7d windows in fixed order", () => {
    const provider: ServerProvider = {
      provider: "codex",
      enabled: true,
      installed: true,
      version: "0.118.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-08T00:00:00.000Z",
      models: [],
      usageLimits: {
        updatedAt: "2026-04-08T00:00:00.000Z",
        windows: [
          {
            label: "7d",
            durationMinutes: 10_080,
            usedPercent: 18,
          },
          {
            label: "30d",
            durationMinutes: 43_200,
            usedPercent: 4,
          },
          {
            label: "5h",
            durationMinutes: 300,
            usedPercent: 42,
          },
        ],
      },
    };

    expect(getCanonicalProviderUsageWindows(provider.usageLimits)).toEqual([
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
    ]);
  });

  it("returns an empty array when no canonical windows exist", () => {
    expect(
      getCanonicalProviderUsageWindows({
        updatedAt: "2026-04-08T00:00:00.000Z",
        windows: [
          {
            label: "30d",
            durationMinutes: 43_200,
            usedPercent: 4,
          },
        ],
      }),
    ).toEqual([]);
    expect(getCanonicalProviderUsageWindows(undefined)).toEqual([]);
  });

  it("returns eligible providers in original order with canonical windows only", () => {
    const providers: ReadonlyArray<ServerProvider> = [
      {
        provider: "claudeAgent",
        enabled: true,
        installed: true,
        version: "1.0.0",
        status: "ready",
        auth: { status: "unauthenticated" },
        checkedAt: "2026-04-08T00:00:00.000Z",
        models: [],
        usageLimits: {
          updatedAt: "2026-04-08T00:00:00.000Z",
          windows: [{ label: "5h", durationMinutes: 300, usedPercent: 15 }],
        },
      },
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
          windows: [
            { label: "7d", durationMinutes: 10_080, usedPercent: 18 },
            { label: "30d", durationMinutes: 43_200, usedPercent: 4 },
            { label: "5h", durationMinutes: 300, usedPercent: 42 },
          ],
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
          windows: [{ label: "5h", durationMinutes: 300 }],
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
          windows: [{ label: "5h", durationMinutes: 300, usedPercent: 90 }],
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
          windows: [{ label: "weekly", durationMinutes: 10_080, usedPercent: 17 }],
        },
      },
    ];

    expect(getSidebarProviderUsageEntries(providers)).toEqual([
      {
        provider: "codex",
        windows: [
          { label: "5h", durationMinutes: 300, usedPercent: 42 },
          { label: "7d", durationMinutes: 10_080, usedPercent: 18 },
        ],
      },
      {
        provider: "claudeAgent",
        windows: [{ label: "5h", durationMinutes: 300 }],
      },
    ]);
  });
});
