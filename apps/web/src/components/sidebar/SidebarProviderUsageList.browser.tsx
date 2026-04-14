import "../../index.css";

import { DEFAULT_SERVER_SETTINGS, type ServerConfig } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import {
  applyServerConfigEvent,
  resetServerStateForTests,
  setServerConfigSnapshot,
  useServerProviders,
} from "../../rpc/serverState";
import { SidebarProviderUsageList } from "./SidebarProviderUsageList";

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function SidebarProviderUsageHarness() {
  const providers = useServerProviders();
  return <SidebarProviderUsageList providers={providers} />;
}

describe("SidebarProviderUsageList", () => {
  beforeEach(() => {
    resetServerStateForTests();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    resetServerStateForTests();
    document.body.innerHTML = "";
  });

  it("updates when provider statuses change after initial render", async () => {
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        {
          provider: "codex",
          enabled: true,
          installed: true,
          version: "0.116.0",
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-04-08T00:00:00.000Z",
          models: [],
        },
      ],
    });

    await render(
      <AppAtomRegistryProvider>
        <SidebarProviderUsageHarness />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByTestId("sidebar-provider-usage-list")).not.toBeInTheDocument();

    applyServerConfigEvent({
      version: 1,
      type: "providerStatuses",
      payload: {
        providers: [
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
        ],
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Codex");
      expect(document.body.textContent ?? "").toContain("Claude");
      expect(document.body.textContent ?? "").toContain("42%");
      expect(document.body.textContent ?? "").toContain("n/a");
    });
  });
});
