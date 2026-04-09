import type {
  ProviderRuntimeEvent,
  ServerProvider,
  ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";

import { normalizeClaudeRateLimits } from "../claudeRateLimits.ts";
import { normalizeCodexRateLimits } from "../codexRateLimits.ts";
import { orderCanonicalUsageWindows } from "../rateLimitUtils.ts";
import {
  ProviderUsageTracker,
  type ProviderUsageSnapshot,
  type ProviderUsageTrackerShape,
} from "../Services/ProviderUsageTracker.ts";
import { ProviderService } from "../Services/ProviderService.ts";

function toComparableSnapshot(snapshot: ProviderUsageSnapshot) {
  return Object.fromEntries(
    Object.entries(snapshot).map(([provider, usageLimits]) => [
      provider,
      usageLimits
        ? {
            ...(usageLimits.limitId ? { limitId: usageLimits.limitId } : {}),
            ...(usageLimits.limitName ? { limitName: usageLimits.limitName } : {}),
            windows: usageLimits.windows,
          }
        : undefined,
    ]),
  );
}

function haveSnapshotsChanged(
  previous: ProviderUsageSnapshot,
  next: ProviderUsageSnapshot,
): boolean {
  return (
    JSON.stringify(toComparableSnapshot(previous)) !== JSON.stringify(toComparableSnapshot(next))
  );
}

function withoutUsageLimits(provider: ServerProvider): ServerProvider {
  const { usageLimits: _usageLimits, ...baseProvider } = provider;
  return baseProvider;
}

function mergeUsageLimits(
  previous: ServerProviderUsageLimits | undefined,
  next: ServerProviderUsageLimits,
): ServerProviderUsageLimits {
  if (!previous) {
    return next;
  }

  const windowsByLabel = new Map(previous.windows.map((window) => [window.label, window] as const));
  for (const window of next.windows) {
    windowsByLabel.set(window.label, window);
  }

  return {
    updatedAt: next.updatedAt,
    ...((next.limitId ?? previous.limitId) ? { limitId: next.limitId ?? previous.limitId } : {}),
    ...((next.limitName ?? previous.limitName)
      ? { limitName: next.limitName ?? previous.limitName }
      : {}),
    windows: orderCanonicalUsageWindows([...windowsByLabel.values()]),
  };
}

export const ProviderUsageTrackerLive = Layer.effect(
  ProviderUsageTracker,
  Effect.gen(function* () {
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ProviderUsageSnapshot>(),
      PubSub.shutdown,
    );
    const snapshotRef = yield* Ref.make<ProviderUsageSnapshot>({});
    const startedRef = yield* Ref.make(false);

    const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (
      event: ProviderRuntimeEvent,
    ) {
      if (event.type !== "account.rate-limits.updated") {
        return;
      }

      const usageLimits =
        event.provider === "codex"
          ? normalizeCodexRateLimits(event.payload, event.createdAt)
          : event.provider === "claudeAgent"
            ? normalizeClaudeRateLimits(event.payload, event.createdAt)
            : null;
      if (!usageLimits) {
        return;
      }

      const previousSnapshot = yield* Ref.get(snapshotRef);
      const nextProviderUsageLimits =
        event.provider === "claudeAgent"
          ? mergeUsageLimits(previousSnapshot[event.provider], usageLimits)
          : usageLimits;
      const nextSnapshot: ProviderUsageSnapshot = {
        ...previousSnapshot,
        [event.provider]: nextProviderUsageLimits,
      };
      if (!haveSnapshotsChanged(previousSnapshot, nextSnapshot)) {
        return;
      }

      yield* Ref.set(snapshotRef, nextSnapshot);
      yield* PubSub.publish(changesPubSub, nextSnapshot);
    });

    const start: ProviderUsageTrackerShape["start"] = Effect.fn("start")(function* () {
      const shouldStart = yield* Ref.modify(startedRef, (started) => [!started, true] as const);
      if (!shouldStart) {
        return;
      }

      const providerService = yield* ProviderService;
      yield* Stream.runForEach(providerService.streamEvents, processRuntimeEvent).pipe(
        Effect.forkScoped,
      );
    });

    const decorateProviders: ProviderUsageTrackerShape["decorateProviders"] = Effect.fn(
      "decorateProviders",
    )(function* (providers) {
      const snapshot = yield* Ref.get(snapshotRef);
      return providers.map((provider) => {
        const baseProvider = withoutUsageLimits(provider);
        const usageLimits = snapshot[provider.provider];
        if (!usageLimits || !provider.enabled || provider.auth.status !== "authenticated") {
          return baseProvider;
        }

        return {
          ...baseProvider,
          usageLimits,
        };
      });
    });

    return {
      start,
      getSnapshot: Ref.get(snapshotRef),
      decorateProviders,
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderUsageTrackerShape;
  }),
);
