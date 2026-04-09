import type { ServerProviderUsageLimitWindow } from "@t3tools/contracts";

export const CANONICAL_USAGE_WINDOW_LABELS = ["5h", "7d"] as const;
export type CanonicalUsageWindowLabel = (typeof CANONICAL_USAGE_WINDOW_LABELS)[number];

export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function clampUsedPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function orderCanonicalUsageWindows(
  windows: ReadonlyArray<ServerProviderUsageLimitWindow>,
): Array<ServerProviderUsageLimitWindow> {
  const windowsByLabel = new Map<string, ServerProviderUsageLimitWindow>();
  for (const window of windows) {
    if (windowsByLabel.has(window.label)) {
      continue;
    }
    windowsByLabel.set(window.label, window);
  }

  return CANONICAL_USAGE_WINDOW_LABELS.flatMap((label) => {
    const window = windowsByLabel.get(label);
    return window ? [window] : [];
  });
}
