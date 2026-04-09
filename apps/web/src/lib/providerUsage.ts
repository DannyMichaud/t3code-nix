import type { ServerProvider, ServerProviderUsageLimitWindow } from "@t3tools/contracts";

const CANONICAL_PROVIDER_USAGE_LABELS = ["5h", "7d"] as const;

export function getCanonicalProviderUsageWindows(
  usageLimits: ServerProvider["usageLimits"] | null | undefined,
): ReadonlyArray<ServerProviderUsageLimitWindow> {
  if (!usageLimits) {
    return [];
  }

  const windowsByLabel = new Map<string, ServerProviderUsageLimitWindow>();
  for (const window of usageLimits.windows) {
    if (!CANONICAL_PROVIDER_USAGE_LABELS.includes(window.label as "5h" | "7d")) {
      continue;
    }
    if (windowsByLabel.has(window.label)) {
      continue;
    }
    windowsByLabel.set(window.label, window);
  }

  return CANONICAL_PROVIDER_USAGE_LABELS.flatMap((label) => {
    const window = windowsByLabel.get(label);
    return window ? [window] : [];
  });
}
