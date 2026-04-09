import assert from "node:assert/strict";

import {
  EventId,
  type ProviderRuntimeEvent,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { Duration, Effect, Layer, PubSub, Stream } from "effect";
import { describe, it } from "vitest";

import { ProviderUsageTracker } from "../Services/ProviderUsageTracker.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import { ProviderUsageTrackerLive } from "./ProviderUsageTracker.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-usage");

function makeProvider(provider: "codex" | "claudeAgent", overrides?: Partial<ServerProvider>) {
  return {
    provider,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" as const },
    checkedAt: "2026-04-08T00:00:00.000Z",
    models: [],
    ...overrides,
  } satisfies ServerProvider;
}

function makeRuntimeEvent(input: {
  provider?: "codex" | "claudeAgent";
  payload: unknown;
}): ProviderRuntimeEvent {
  return {
    eventId: EventId.makeUnsafe(`evt-${crypto.randomUUID()}`),
    provider: input.provider ?? "codex",
    threadId: THREAD_ID,
    createdAt: "2026-04-08T00:00:00.000Z",
    type: "account.rate-limits.updated",
    payload: {
      rateLimits: input.payload,
    },
  };
}

function makeClaudeRateLimitPayload(input: {
  rateLimitType: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage";
  utilization?: number;
}) {
  return {
    type: "rate_limit_event" as const,
    rate_limit_info: {
      status: "allowed" as const,
      rateLimitType: input.rateLimitType,
      ...(input.utilization !== undefined ? { utilization: input.utilization } : {}),
    },
    uuid: crypto.randomUUID(),
    session_id: `session-${crypto.randomUUID()}`,
  };
}

function makeProviderServiceMock(
  runtimeEvents: PubSub.PubSub<ProviderRuntimeEvent>,
): ProviderServiceShape {
  const unused = Effect.die(new Error("ProviderService method is not used in this test"));
  return {
    startSession: () => unused,
    sendTurn: () => unused,
    interruptTurn: () => unused,
    respondToRequest: () => unused,
    respondToUserInput: () => unused,
    stopSession: () => unused,
    listSessions: () => unused,
    getCapabilities: () => unused,
    rollbackConversation: () => unused,
    streamEvents: Stream.fromPubSub(runtimeEvents),
  };
}

function buildTrackerHarness() {
  return Effect.gen(function* () {
    const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const providerServiceLayer = Layer.succeed(
      ProviderService,
      makeProviderServiceMock(runtimeEvents),
    );
    const trackerLayer = ProviderUsageTrackerLive.pipe(Layer.provide(providerServiceLayer));
    const tracker = yield* Effect.service(ProviderUsageTracker).pipe(Effect.provide(trackerLayer));

    yield* tracker.start().pipe(Effect.provide(providerServiceLayer));
    yield* Effect.sleep(Duration.millis(10));

    return {
      tracker,
      publish: (event: ProviderRuntimeEvent) => PubSub.publish(runtimeEvents, event),
    } as const;
  });
}

describe("ProviderUsageTracker", () => {
  it("normalizes valid Codex snapshots into canonical 5h and 7d windows", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildTrackerHarness();

          yield* harness.publish(
            makeRuntimeEvent({
              payload: {
                limitId: "codex",
                limitName: "Codex",
                primary: {
                  usedPercent: 104,
                },
                secondary: {
                  usedPercent: -4,
                },
                credits: null,
                planType: "pro",
              },
            }),
          );
          yield* Effect.sleep(Duration.millis(10));

          const snapshot = yield* harness.tracker.getSnapshot;
          assert.deepStrictEqual(snapshot.codex, {
            updatedAt: "2026-04-08T00:00:00.000Z",
            limitId: "codex",
            limitName: "Codex",
            windows: [
              {
                label: "5h",
                durationMinutes: 300,
                usedPercent: 100,
              },
              {
                label: "7d",
                durationMinutes: 10_080,
                usedPercent: 0,
              },
            ],
          });

          const decoratedProviders = yield* harness.tracker.decorateProviders([
            makeProvider("codex"),
            makeProvider("codex", {
              enabled: false,
            }),
            makeProvider("codex", {
              auth: { status: "unauthenticated" },
            }),
            makeProvider("claudeAgent"),
          ]);

          assert.deepStrictEqual(decoratedProviders[0]?.usageLimits, snapshot.codex);
          assert.equal(decoratedProviders[1]?.usageLimits, undefined);
          assert.equal(decoratedProviders[2]?.usageLimits, undefined);
          assert.equal(decoratedProviders[3]?.usageLimits, undefined);
        }),
      ),
    );
  });

  it("ignores malformed Codex payloads", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildTrackerHarness();

          yield* harness.publish(
            makeRuntimeEvent({
              payload: {
                primary: {
                  windowDurationMins: 300,
                },
              },
            }),
          );
          yield* Effect.sleep(Duration.millis(10));

          assert.deepStrictEqual(yield* harness.tracker.getSnapshot, {});
        }),
      ),
    );
  });

  it("does not republish duplicate snapshots", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildTrackerHarness();
          const event = makeRuntimeEvent({
            payload: {
              limitId: "codex",
              primary: {
                usedPercent: 42,
                windowDurationMins: 300,
              },
              secondary: {
                usedPercent: 18,
                windowDurationMins: 10_080,
              },
            },
          });
          const nextEvent = {
            ...event,
            eventId: EventId.makeUnsafe(`evt-${crypto.randomUUID()}`),
            createdAt: "2026-04-08T00:05:00.000Z",
          } satisfies ProviderRuntimeEvent;

          yield* harness.publish(event);
          yield* harness.publish(nextEvent);
          yield* Effect.sleep(Duration.millis(1));

          const snapshot = yield* harness.tracker.getSnapshot;
          assert.equal(snapshot.codex?.updatedAt, "2026-04-08T00:00:00.000Z");
        }),
      ),
    );
  });

  it("merges Claude five_hour and seven_day events into canonical windows", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildTrackerHarness();

          yield* harness.publish(
            makeRuntimeEvent({
              provider: "claudeAgent",
              payload: makeClaudeRateLimitPayload({
                rateLimitType: "five_hour",
                utilization: 0.429,
              }),
            }),
          );
          yield* harness.publish(
            makeRuntimeEvent({
              provider: "claudeAgent",
              payload: makeClaudeRateLimitPayload({
                rateLimitType: "seven_day",
                utilization: 0.181,
              }),
            }),
          );
          yield* Effect.sleep(Duration.millis(1));

          const snapshot = yield* harness.tracker.getSnapshot;
          assert.deepStrictEqual(snapshot.claudeAgent, {
            updatedAt: "2026-04-08T00:00:00.000Z",
            windows: [
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
            ],
          });

          const decoratedProviders = yield* harness.tracker.decorateProviders([
            makeProvider("claudeAgent"),
          ]);
          assert.deepStrictEqual(decoratedProviders[0]?.usageLimits, snapshot.claudeAgent);
        }),
      ),
    );
  });

  it("keeps Claude windows when utilization is unavailable", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildTrackerHarness();

          yield* harness.publish(
            makeRuntimeEvent({
              provider: "claudeAgent",
              payload: makeClaudeRateLimitPayload({
                rateLimitType: "five_hour",
              }),
            }),
          );
          yield* Effect.sleep(Duration.millis(1));

          const snapshot = yield* harness.tracker.getSnapshot;
          assert.deepStrictEqual(snapshot.claudeAgent, {
            updatedAt: "2026-04-08T00:00:00.000Z",
            windows: [
              {
                label: "5h",
                durationMinutes: 300,
              },
            ],
          });
        }),
      ),
    );
  });

  it("ignores unsupported Claude rate-limit variants", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildTrackerHarness();

          yield* harness.publish(
            makeRuntimeEvent({
              provider: "claudeAgent",
              payload: makeClaudeRateLimitPayload({
                rateLimitType: "seven_day_opus",
                utilization: 0.75,
              }),
            }),
          );
          yield* harness.publish(
            makeRuntimeEvent({
              provider: "claudeAgent",
              payload: makeClaudeRateLimitPayload({
                rateLimitType: "overage",
                utilization: 0.25,
              }),
            }),
          );
          yield* Effect.sleep(Duration.millis(1));

          assert.deepStrictEqual(yield* harness.tracker.getSnapshot, {});
        }),
      ),
    );
  });

  it("does not republish duplicate Claude windows", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildTrackerHarness();
          const event = makeRuntimeEvent({
            provider: "claudeAgent",
            payload: makeClaudeRateLimitPayload({
              rateLimitType: "five_hour",
              utilization: 0.42,
            }),
          });
          const nextEvent = {
            ...event,
            eventId: EventId.makeUnsafe(`evt-${crypto.randomUUID()}`),
            createdAt: "2026-04-08T00:05:00.000Z",
          } satisfies ProviderRuntimeEvent;

          yield* harness.publish(event);
          yield* harness.publish(nextEvent);
          yield* Effect.sleep(Duration.millis(1));

          const snapshot = yield* harness.tracker.getSnapshot;
          assert.equal(snapshot.claudeAgent?.updatedAt, "2026-04-08T00:00:00.000Z");
        }),
      ),
    );
  });
});
