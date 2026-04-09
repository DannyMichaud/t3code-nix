import type { ProviderRuntimeEvent, ServerProvider } from "@t3tools/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";

import { normalizeCodexRateLimits } from "../codexRateLimits.ts";
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
      if (event.provider !== "codex") {
        return;
      }

      const usageLimits = normalizeCodexRateLimits(event.payload, event.createdAt);
      if (!usageLimits) {
        return;
      }

      const previousSnapshot = yield* Ref.get(snapshotRef);
      const nextSnapshot: ProviderUsageSnapshot = {
        ...previousSnapshot,
        [event.provider]: usageLimits,
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
