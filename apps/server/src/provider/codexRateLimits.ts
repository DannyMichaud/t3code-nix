import type { ServerProviderUsageLimitWindow, ServerProviderUsageLimits } from "@t3tools/contracts";

type CanonicalUsageWindow = ServerProviderUsageLimitWindow & {
  label: "5h" | "7d";
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function looksLikeRateLimitSnapshot(value: unknown): value is Record<string, unknown> {
  const record = asObject(value);
  if (!record) {
    return false;
  }
  return (
    "primary" in record ||
    "secondary" in record ||
    "limitId" in record ||
    "limitName" in record ||
    "credits" in record ||
    "planType" in record
  );
}

function normalizeWindow(input: {
  readonly value: unknown;
  readonly fallbackLabel: "5h" | "7d";
}): CanonicalUsageWindow | null {
  const record = asObject(input.value);
  if (!record) {
    return null;
  }

  const usedPercent = asNumber(record.usedPercent);
  if (usedPercent === undefined) {
    return null;
  }

  const durationMinutes = asNumber(record.windowDurationMins);
  if (durationMinutes === 300) {
    return {
      label: "5h",
      durationMinutes,
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
    };
  }
  if (durationMinutes === 10_080) {
    return {
      label: "7d",
      durationMinutes,
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
    };
  }
  if (durationMinutes !== undefined) {
    return null;
  }

  return {
    label: input.fallbackLabel,
    durationMinutes: input.fallbackLabel === "5h" ? 300 : 10_080,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
  };
}

export function selectCodexRateLimitSnapshot(response: unknown): unknown | null {
  const record = asObject(response);
  if (!record) {
    return null;
  }

  const rateLimitsByLimitId = asObject(record.rateLimitsByLimitId);
  if (rateLimitsByLimitId?.codex !== undefined && rateLimitsByLimitId.codex !== null) {
    return rateLimitsByLimitId.codex;
  }

  return record.rateLimits ?? null;
}

export function extractCodexRateLimitSnapshot(payload: unknown): unknown | null {
  if (looksLikeRateLimitSnapshot(payload)) {
    return payload;
  }

  const record = asObject(payload);
  if (!record) {
    return null;
  }

  if (looksLikeRateLimitSnapshot(record.rateLimits)) {
    return record.rateLimits;
  }

  const nestedRateLimits = asObject(record.rateLimits);
  if (looksLikeRateLimitSnapshot(nestedRateLimits?.rateLimits)) {
    return nestedRateLimits?.rateLimits ?? null;
  }

  return null;
}

export function normalizeCodexRateLimits(
  snapshot: unknown,
  updatedAt: string,
): ServerProviderUsageLimits | null {
  const normalizedSnapshot = asObject(extractCodexRateLimitSnapshot(snapshot));
  if (!normalizedSnapshot) {
    return null;
  }

  const windowsByLabel = new Map<"5h" | "7d", CanonicalUsageWindow>();
  const primaryWindow = normalizeWindow({
    value: normalizedSnapshot.primary,
    fallbackLabel: "5h",
  });
  const secondaryWindow = normalizeWindow({
    value: normalizedSnapshot.secondary,
    fallbackLabel: "7d",
  });

  for (const window of [primaryWindow, secondaryWindow]) {
    if (!window || windowsByLabel.has(window.label)) {
      continue;
    }
    windowsByLabel.set(window.label, window);
  }

  const windows: ServerProviderUsageLimitWindow[] = (["5h", "7d"] as const).flatMap((label) => {
    const window = windowsByLabel.get(label);
    return window ? [window] : [];
  });
  if (windows.length === 0) {
    return null;
  }

  const limitId = asString(normalizedSnapshot.limitId);
  const limitName = asString(normalizedSnapshot.limitName);

  return {
    updatedAt,
    ...(limitId ? { limitId } : {}),
    ...(limitName ? { limitName } : {}),
    windows,
  };
}
