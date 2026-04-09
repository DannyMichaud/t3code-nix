import type { ProviderKind, ServerProvider, ServerProviderUsageLimits } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope, Stream } from "effect";

import type { ProviderService } from "./ProviderService.ts";

export type ProviderUsageSnapshot = Partial<Record<ProviderKind, ServerProviderUsageLimits>>;

export interface ProviderUsageTrackerShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope | ProviderService>;
  readonly getSnapshot: Effect.Effect<ProviderUsageSnapshot>;
  readonly decorateProviders: (
    providers: ReadonlyArray<ServerProvider>,
  ) => Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly streamChanges: Stream.Stream<ProviderUsageSnapshot>;
}

export class ProviderUsageTracker extends ServiceMap.Service<
  ProviderUsageTracker,
  ProviderUsageTrackerShape
>()("t3/provider/Services/ProviderUsageTracker") {}
