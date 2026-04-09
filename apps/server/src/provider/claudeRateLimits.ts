import type { ServerProviderUsageLimits } from "@t3tools/contracts";

import {
  asNumber,
  asObject,
  asString,
  clampUsedPercent,
  orderCanonicalUsageWindows,
  type CanonicalUsageWindowLabel,
} from "./rateLimitUtils.ts";

function looksLikeClaudeRateLimitInfo(value: unknown): boolean {
  const record = asObject(value);
  if (!record) {
    return false;
  }
  return (
    "rateLimitType" in record ||
    "utilization" in record ||
    "resetsAt" in record ||
    "status" in record
  );
}

function looksLikeClaudeRateLimitEvent(value: unknown): boolean {
  const record = asObject(value);
  if (!record) {
    return false;
  }
  return record.type === "rate_limit_event" || "rate_limit_info" in record;
}

export function extractClaudeRateLimitInfo(payload: unknown): unknown | null {
  if (looksLikeClaudeRateLimitInfo(payload)) {
    return asObject(payload);
  }

  const record = asObject(payload);
  if (!record) {
    return null;
  }

  if (looksLikeClaudeRateLimitEvent(record)) {
    const rateLimitInfo = asObject(record.rate_limit_info);
    return looksLikeClaudeRateLimitInfo(rateLimitInfo) ? rateLimitInfo : null;
  }

  const directRateLimits = asObject(record.rateLimits);
  if (looksLikeClaudeRateLimitInfo(directRateLimits)) {
    return directRateLimits;
  }

  const nestedRateLimits = directRateLimits;
  if (looksLikeClaudeRateLimitEvent(nestedRateLimits)) {
    const rateLimitInfo = asObject(nestedRateLimits?.rate_limit_info);
    return looksLikeClaudeRateLimitInfo(rateLimitInfo) ? rateLimitInfo : null;
  }

  return null;
}

function normalizeRateLimitLabel(rateLimitType: string): CanonicalUsageWindowLabel | null {
  switch (rateLimitType) {
    case "five_hour":
      return "5h";
    case "seven_day":
      return "7d";
    default:
      return null;
  }
}

function normalizeRateLimitDurationMinutes(label: CanonicalUsageWindowLabel): number {
  return label === "5h" ? 300 : 10_080;
}

export function normalizeClaudeRateLimits(
  snapshot: unknown,
  updatedAt: string,
): ServerProviderUsageLimits | null {
  const rateLimitInfo = asObject(extractClaudeRateLimitInfo(snapshot));
  if (!rateLimitInfo) {
    return null;
  }

  const rateLimitType = asString(rateLimitInfo.rateLimitType);
  if (!rateLimitType) {
    return null;
  }

  const label = normalizeRateLimitLabel(rateLimitType);
  if (!label) {
    return null;
  }

  const utilization = asNumber(rateLimitInfo.utilization);

  return {
    updatedAt,
    windows: orderCanonicalUsageWindows([
      {
        label,
        durationMinutes: normalizeRateLimitDurationMinutes(label),
        ...(utilization !== undefined
          ? {
              usedPercent: clampUsedPercent(Math.floor(utilization * 100)),
            }
          : {}),
      },
    ]),
  };
}
