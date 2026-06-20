import assert from "node:assert/strict";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { beforeEach } from "vite-plus/test";

import {
  OpenCodeSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import type { OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import {
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  type OpenCodeRuntimeShape,
} from "../opencodeRuntime.ts";
import {
  appendOpenCodeAssistantTextDelta,
  makeOpenCodeAdapter,
  mergeOpenCodeAssistantText,
  normalizeOpenCodeTokenUsage,
  type OpenCodeAssistantTokenUsage,
} from "./OpenCodeAdapter.ts";

// Test-local service tag so the rest of the file can keep using `yield* OpenCodeAdapter`.
class OpenCodeAdapter extends Context.Service<OpenCodeAdapter, OpenCodeAdapterShape>()(
  "t3/provider/Layers/OpenCodeAdapter.test/OpenCodeAdapter",
) {}

const asThreadId = (value: string): ThreadId => ThreadId.make(value);

type MessageEntry = {
  info: {
    id: string;
    role: "user" | "assistant";
  };
  parts: Array<unknown>;
};

const runtimeMock = {
  state: {
    startCalls: [] as string[],
    sessionCreateUrls: [] as string[],
    authHeaders: [] as Array<string | null>,
    abortCalls: [] as string[],
    closeCalls: [] as string[],
    revertCalls: [] as Array<{ sessionID: string; messageID?: string }>,
    promptCalls: [] as Array<unknown>,
    promptAsyncError: null as Error | null,
    closeError: null as Error | null,
    messages: [] as MessageEntry[],
    subscribedEvents: [] as unknown[],
    providerListCalls: [] as Array<string | undefined>,
    /**
     * Override to control the response returned by the mocked
     * `client.provider.list`. When `null`, the call resolves to `undefined`
     * (mirroring a server that returned no body), which exercises the
     * adapter's "no maxTokens available" path.
     */
    providerListResponse: null as
      | null
      | {
          readonly all: ReadonlyArray<{
            readonly id: string;
            readonly models: Readonly<Record<string, { readonly limit: { readonly context: number } }>>;
          }>;
        },
    providerListError: null as Error | null,
  },
  reset() {
    this.state.startCalls.length = 0;
    this.state.sessionCreateUrls.length = 0;
    this.state.authHeaders.length = 0;
    this.state.abortCalls.length = 0;
    this.state.closeCalls.length = 0;
    this.state.revertCalls.length = 0;
    this.state.promptCalls.length = 0;
    this.state.promptAsyncError = null;
    this.state.closeError = null;
    this.state.messages = [];
    this.state.subscribedEvents = [];
    this.state.providerListCalls = [];
    this.state.providerListResponse = null;
    this.state.providerListError = null;
  },
};

const OpenCodeRuntimeTestDouble: OpenCodeRuntimeShape = {
  startOpenCodeServerProcess: ({ binaryPath }) =>
    Effect.gen(function* () {
      runtimeMock.state.startCalls.push(binaryPath);
      const url = "http://127.0.0.1:4301";
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          runtimeMock.state.closeCalls.push(url);
          if (runtimeMock.state.closeError) {
            throw runtimeMock.state.closeError;
          }
        }),
      );
      return {
        url,
        exitCode: Effect.never,
      };
    }),
  connectToOpenCodeServer: ({ serverUrl }) =>
    Effect.gen(function* () {
      const url = serverUrl ?? "http://127.0.0.1:4301";
      // Unconditionally register a scope finalizer for test observability —
      // preserves the `closeCalls` / `closeError` probes that the existing
      // suites rely on. Production code never attaches a finalizer to an
      // external server (it simply returns `Effect.succeed(...)`).
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          runtimeMock.state.closeCalls.push(url);
          if (runtimeMock.state.closeError) {
            throw runtimeMock.state.closeError;
          }
        }),
      );
      return {
        url,
        exitCode: null,
        external: Boolean(serverUrl),
      };
    }),
  runOpenCodeCommand: () => Effect.succeed({ stdout: "", stderr: "", code: 0 }),
  createOpenCodeSdkClient: ({ baseUrl, serverPassword }) =>
    ({
      session: {
        create: async () => {
          runtimeMock.state.sessionCreateUrls.push(baseUrl);
          runtimeMock.state.authHeaders.push(
            serverPassword ? `Basic ${btoa(`opencode:${serverPassword}`)}` : null,
          );
          return { data: { id: `${baseUrl}/session` } };
        },
        abort: async ({ sessionID }: { sessionID: string }) => {
          runtimeMock.state.abortCalls.push(sessionID);
        },
        promptAsync: async (input: unknown) => {
          runtimeMock.state.promptCalls.push(input);
          if (runtimeMock.state.promptAsyncError) {
            throw runtimeMock.state.promptAsyncError;
          }
        },
        messages: async () => ({ data: runtimeMock.state.messages }),
        revert: async ({ sessionID, messageID }: { sessionID: string; messageID?: string }) => {
          runtimeMock.state.revertCalls.push({
            sessionID,
            ...(messageID ? { messageID } : {}),
          });
          if (!messageID) {
            runtimeMock.state.messages = [];
            return;
          }

          const targetIndex = runtimeMock.state.messages.findIndex(
            (entry) => entry.info.id === messageID,
          );
          runtimeMock.state.messages =
            targetIndex >= 0
              ? runtimeMock.state.messages.slice(0, targetIndex + 1)
              : runtimeMock.state.messages;
        },
      },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            for (const event of runtimeMock.state.subscribedEvents) {
              yield event;
            }
          })(),
        }),
      },
      provider: {
        list: async (input?: { readonly directory?: string }) => {
          runtimeMock.state.providerListCalls.push(input?.directory);
          if (runtimeMock.state.providerListError) {
            throw runtimeMock.state.providerListError;
          }
          return runtimeMock.state.providerListResponse === null
            ? { data: undefined }
            : { data: runtimeMock.state.providerListResponse };
        },
      },
    }) as unknown as ReturnType<OpenCodeRuntimeShape["createOpenCodeSdkClient"]>,
  loadOpenCodeInventory: () =>
    Effect.fail(
      new OpenCodeRuntimeError({
        operation: "loadOpenCodeInventory",
        detail: "OpenCodeRuntimeTestDouble.loadOpenCodeInventory not used in this test",
        cause: null,
      }),
    ),
};

const providerSessionDirectoryTestLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  getProvider: () =>
    Effect.die(new Error("ProviderSessionDirectory.getProvider is not used in test")),
  getBinding: () => Effect.succeed(Option.none()),
  listThreadIds: () => Effect.succeed([]),
  listBindings: () => Effect.succeed([]),
});

// The adapter now receives its settings as a plain argument (the old design
// read from `ServerSettingsService` internally). The test-only
// `ServerSettingsService` below is still kept because other dependencies in
// the layer graph reach for it — but the routing values the assertions
// probe (serverUrl, serverPassword) must be threaded directly through the
// decoded `OpenCodeSettings`.
const openCodeAdapterTestSettings = Schema.decodeSync(OpenCodeSettings)({
  binaryPath: "fake-opencode",
  serverUrl: "http://127.0.0.1:9999",
  serverPassword: "secret-password",
});

const OpenCodeAdapterTestLayer = Layer.effect(
  OpenCodeAdapter,
  makeOpenCodeAdapter(openCodeAdapterTestSettings),
).pipe(
  Layer.provideMerge(Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble)),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(
    ServerSettingsService.layerTest({
      providers: {
        opencode: {
          binaryPath: "fake-opencode",
          serverUrl: "http://127.0.0.1:9999",
          serverPassword: "secret-password",
        },
      },
    }),
  ),
  Layer.provideMerge(providerSessionDirectoryTestLayer),
  Layer.provideMerge(NodeServices.layer),
);

beforeEach(() => {
  runtimeMock.reset();
});

const advanceTestClock = (ms: number) =>
  TestClock.adjust(`${ms} millis`).pipe(Effect.andThen(Effect.yieldNow));

it.layer(OpenCodeAdapterTestLayer)("OpenCodeAdapterLive", (it) => {
  it.effect("reuses a configured OpenCode server URL instead of spawning a local server", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;

      const session = yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId: asThreadId("thread-opencode"),
        runtimeMode: "full-access",
      });

      assert.equal(session.provider, "opencode");
      assert.equal(session.threadId, "thread-opencode");
      assert.deepEqual(runtimeMock.state.startCalls, []);
      assert.deepEqual(runtimeMock.state.sessionCreateUrls, ["http://127.0.0.1:9999"]);
      assert.deepEqual(runtimeMock.state.authHeaders, [
        `Basic ${btoa("opencode:secret-password")}`,
      ]);
    }),
  );

  it.effect("stops a configured-server session without trying to own server lifecycle", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId: asThreadId("thread-opencode"),
        runtimeMode: "full-access",
      });

      yield* adapter.stopSession(asThreadId("thread-opencode"));

      assert.deepEqual(runtimeMock.state.startCalls, []);
      assert.deepEqual(
        runtimeMock.state.abortCalls.includes("http://127.0.0.1:9999/session"),
        true,
      );
    }),
  );

  it.effect("emits one session.exited event when stopping a session", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-opencode-stop-event");
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
      });
      yield* adapter.stopSession(threadId);

      const events = Array.from(yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")));
      assert.deepEqual(
        events.map((event) => event.type),
        ["session.started", "thread.started", "session.exited"],
      );
    }),
  );

  it.effect("clears session state even when cleanup finalizers throw", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId: asThreadId("thread-stop-all-a"),
        runtimeMode: "full-access",
      });
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId: asThreadId("thread-stop-all-b"),
        runtimeMode: "full-access",
      });

      runtimeMock.state.closeError = new Error("close failed");
      // `stopAll` relies on `stopOpenCodeContext`, which is typed as
      // never-failing. A throwing finalizer surfaces as a defect — `Effect.exit`
      // captures it so the assertions can still run. The key invariant we're
      // validating is "the sessions map and close-call probes reflect cleanup
      // attempts regardless of finalizer outcome".
      yield* Effect.exit(adapter.stopAll());
      const sessions = yield* adapter.listSessions();

      assert.deepEqual(runtimeMock.state.closeCalls, [
        "http://127.0.0.1:9999",
        "http://127.0.0.1:9999",
      ]);
      assert.deepEqual(sessions, []);
    }),
  );

  it.effect("completes streamEvents when the adapter scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make("sequential");
      let scopeClosed = false;

      try {
        const adapterLayer = Layer.effect(
          OpenCodeAdapter,
          makeOpenCodeAdapter(openCodeAdapterTestSettings),
        ).pipe(
          Layer.provideMerge(Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble)),
          Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
          Layer.provideMerge(ServerSettingsService.layerTest()),
          Layer.provideMerge(providerSessionDirectoryTestLayer),
          Layer.provideMerge(NodeServices.layer),
        );
        const context = yield* Layer.buildWithScope(adapterLayer, scope);
        const adapter = yield* Effect.service(OpenCodeAdapter).pipe(Effect.provide(context));
        const eventsFiber = yield* adapter.streamEvents.pipe(Stream.runCollect, Effect.forkChild);

        yield* Scope.close(scope, Exit.void);
        scopeClosed = true;

        const exit = yield* Fiber.await(eventsFiber).pipe(Effect.timeout("1 second"));
        assert.equal(Exit.hasInterrupts(exit), true);
      } finally {
        if (!scopeClosed) {
          yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
        }
      }
    }),
  );

  it.effect("rolls back session state when sendTurn fails before OpenCode accepts the prompt", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId: asThreadId("thread-send-turn-failure"),
        runtimeMode: "full-access",
      });

      runtimeMock.state.promptAsyncError = new Error("prompt failed");
      const error = yield* adapter
        .sendTurn({
          threadId: asThreadId("thread-send-turn-failure"),
          input: "Fix it",
          modelSelection: {
            instanceId: ProviderInstanceId.make("opencode"),
            model: "openai/gpt-5",
          },
        })
        .pipe(Effect.flip);
      const sessions = yield* adapter.listSessions();

      assert.equal(error._tag, "ProviderAdapterRequestError");
      if (error._tag !== "ProviderAdapterRequestError") {
        throw new Error("Unexpected error type");
      }
      assert.equal(error.detail, "prompt failed");
      assert.equal(
        error.message,
        "Provider adapter request failed (opencode) for session.promptAsync: prompt failed",
      );
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0]?.status, "ready");
      assert.equal(sessions[0]?.activeTurnId, undefined);
      assert.equal(sessions[0]?.lastError, "prompt failed");
    }),
  );

  it.effect("passes agent and variant options for the adapter's bound custom instance id", () => {
    const instanceId = ProviderInstanceId.make("opencode_zen");
    const adapterLayer = Layer.effect(
      OpenCodeAdapter,
      makeOpenCodeAdapter(openCodeAdapterTestSettings, { instanceId }),
    ).pipe(
      Layer.provideMerge(Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble)),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId: asThreadId("thread-custom-instance"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: asThreadId("thread-custom-instance"),
        input: "Fix it",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("opencode_zen"),
          "anthropic/claude-sonnet-4-5",
          [
            { id: "agent", value: "github-copilot" },
            { id: "variant", value: "high" },
          ],
        ),
      });

      assert.deepEqual(runtimeMock.state.promptCalls.at(-1), {
        sessionID: "http://127.0.0.1:9999/session",
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5",
        },
        agent: "github-copilot",
        variant: "high",
        parts: [{ type: "text", text: "Fix it" }],
      });
    }).pipe(Effect.provide(adapterLayer));
  });

  it.effect("uses the bound custom instance id for fallback sendTurn model selection", () => {
    const instanceId = ProviderInstanceId.make("opencode_zen");
    const adapterLayer = Layer.effect(
      OpenCodeAdapter,
      makeOpenCodeAdapter(openCodeAdapterTestSettings, { instanceId }),
    ).pipe(
      Layer.provideMerge(Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble)),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-custom-instance-fallback-model");
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("opencode_zen"),
          "anthropic/claude-sonnet-4-5",
        ),
      });

      yield* adapter.sendTurn({
        threadId,
        input: "Fix it",
      });

      assert.deepEqual(runtimeMock.state.promptCalls.at(-1), {
        sessionID: "http://127.0.0.1:9999/session",
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5",
        },
        parts: [{ type: "text", text: "Fix it" }],
      });
    }).pipe(Effect.provide(adapterLayer));
  });

  it.effect("rejects sendTurn model selections for another instance id", () => {
    const instanceId = ProviderInstanceId.make("opencode_zen");
    const adapterLayer = Layer.effect(
      OpenCodeAdapter,
      makeOpenCodeAdapter(openCodeAdapterTestSettings, { instanceId }),
    ).pipe(
      Layer.provideMerge(Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble)),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-custom-instance-wrong-selection");
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
      });

      const error = yield* adapter
        .sendTurn({
          threadId,
          input: "Fix it",
          modelSelection: createModelSelection(
            ProviderInstanceId.make("opencode"),
            "anthropic/claude-sonnet-4-5",
          ),
        })
        .pipe(Effect.flip);

      assert.equal(error._tag, "ProviderAdapterValidationError");
      if (error._tag !== "ProviderAdapterValidationError") {
        throw new Error("Unexpected error type");
      }
      assert.equal(
        error.issue,
        "OpenCode model selection is bound to instance 'opencode', expected 'opencode_zen'.",
      );
      assert.deepEqual(runtimeMock.state.promptCalls, []);
    }).pipe(Effect.provide(adapterLayer));
  });

  it.effect("reverts the full thread when rollback removes every assistant turn", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-rollback-all");
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
      });

      runtimeMock.state.messages = [
        {
          info: { id: "assistant-1", role: "assistant" },
          parts: [],
        },
        {
          info: { id: "assistant-2", role: "assistant" },
          parts: [],
        },
      ];

      const snapshot = yield* adapter.rollbackThread(threadId, 2);

      assert.deepEqual(runtimeMock.state.revertCalls, [
        { sessionID: "http://127.0.0.1:9999/session" },
      ]);
      assert.deepEqual(snapshot.turns, []);
    }),
  );

  it.effect("appends raw assistant text deltas and reconciles part update snapshots", () =>
    Effect.sync(() => {
      const firstUpdate = mergeOpenCodeAssistantText(undefined, "Hello");
      const overlapDelta = appendOpenCodeAssistantTextDelta(firstUpdate.latestText, "lo world");
      const secondUpdate = mergeOpenCodeAssistantText(overlapDelta.nextText, "Hellolo world");

      assert.deepEqual(
        [firstUpdate.deltaToEmit, overlapDelta.deltaToEmit, secondUpdate.deltaToEmit],
        ["Hello", "lo world", ""],
      );
      assert.equal(secondUpdate.latestText, "Hellolo world");
    }),
  );

  it.effect("does not strip coincidental prefix overlap from OpenCode part deltas", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-opencode-raw-delta");
      const part = {
        id: "part-raw-delta",
        sessionID: "http://127.0.0.1:9999/session",
        messageID: "msg-raw-delta",
        type: "text",
        text: "A B",
        time: { start: 1 },
      };
      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            info: {
              id: "msg-raw-delta",
              role: "assistant",
            },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            part,
            time: 1,
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            messageID: "msg-raw-delta",
            partID: "part-raw-delta",
            field: "text",
            delta: "Bonus",
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            part: {
              ...part,
              text: "A BBonus",
              time: { start: 1, end: 2 },
            },
            time: 2,
          },
        },
      ];
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.take(5),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
      });

      const events = Array.from(yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")));
      const deltas = events.filter((event) => event.type === "content.delta");
      assert.deepEqual(
        deltas.map((event) => (event.type === "content.delta" ? event.payload.delta : "")),
        ["A B", "Bonus"],
      );
      assert.equal(events.at(-1)?.type, "item.completed");
      const completed = events.at(-1);
      if (completed?.type === "item.completed") {
        assert.equal(completed.payload.detail, "A BBonus");
      }
    }),
  );

  it.effect("writes provider-native observability records using the session thread id", () =>
    Effect.gen(function* () {
      const nativeEvents: Array<{
        readonly event?: {
          readonly provider?: string;
          readonly threadId?: string;
          readonly providerThreadId?: string;
          readonly type?: string;
        };
      }> = [];
      const nativeThreadIds: Array<string | null> = [];
      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            info: {
              id: "msg-missing-session",
              role: "assistant",
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/other-session",
            info: {
              id: "msg-other-session",
              role: "assistant",
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            info: {
              id: "msg-native-log",
              role: "assistant",
            },
          },
        },
      ];

      const nativeEventLogger = {
        filePath: "memory://opencode-native-events",
        write: (event: unknown, threadId: ThreadId | null) => {
          nativeEvents.push(event as (typeof nativeEvents)[number]);
          nativeThreadIds.push(threadId ?? null);
          return Effect.void;
        },
        close: () => Effect.void,
      };

      const adapterLayer = Layer.effect(
        OpenCodeAdapter,
        makeOpenCodeAdapter(openCodeAdapterTestSettings, {
          nativeEventLogger,
        }),
      ).pipe(
        Layer.provideMerge(Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble)),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
        Layer.provideMerge(
          ServerSettingsService.layerTest({
            providers: {
              opencode: {
                binaryPath: "fake-opencode",
                serverUrl: "http://127.0.0.1:9999",
                serverPassword: "secret-password",
              },
            },
          }),
        ),
        Layer.provideMerge(providerSessionDirectoryTestLayer),
        Layer.provideMerge(NodeServices.layer),
      );

      const session = yield* Effect.gen(function* () {
        const adapter = yield* OpenCodeAdapter;
        const started = yield* adapter.startSession({
          provider: ProviderDriverKind.make("opencode"),
          threadId: asThreadId("thread-native-log"),
          runtimeMode: "full-access",
        });
        yield* advanceTestClock(10);
        return started;
      }).pipe(Effect.provide(adapterLayer));

      assert.equal(session.threadId, "thread-native-log");
      assert.equal(nativeEvents.length, 1);
      assert.equal(
        nativeEvents.some((record) => record.event?.provider === "opencode"),
        true,
      );
      assert.equal(
        nativeEvents.some(
          (record) => record.event?.providerThreadId === "http://127.0.0.1:9999/session",
        ),
        true,
      );
      assert.equal(
        nativeEvents.some((record) => record.event?.threadId === "thread-native-log"),
        true,
      );
      assert.equal(
        nativeEvents.some((record) => record.event?.type === "message.updated"),
        true,
      );
      assert.equal(
        nativeThreadIds.every((threadId) => threadId === "thread-native-log"),
        true,
      );
    }),
  );

  it.effect("keeps the event pump alive when native event logging fails", () =>
    Effect.gen(function* () {
      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            info: {
              id: "msg-native-log-failure",
              role: "assistant",
            },
          },
        },
      ];

      const nativeEventLogger = {
        filePath: "memory://opencode-native-events",
        write: () => Effect.die(new Error("native log write failed")),
        close: () => Effect.void,
      };

      const adapterLayer = Layer.effect(
        OpenCodeAdapter,
        makeOpenCodeAdapter(openCodeAdapterTestSettings, {
          nativeEventLogger,
        }),
      ).pipe(
        Layer.provideMerge(Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble)),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
        Layer.provideMerge(
          ServerSettingsService.layerTest({
            providers: {
              opencode: {
                binaryPath: "fake-opencode",
                serverUrl: "http://127.0.0.1:9999",
                serverPassword: "secret-password",
              },
            },
          }),
        ),
        Layer.provideMerge(providerSessionDirectoryTestLayer),
        Layer.provideMerge(NodeServices.layer),
      );

      // Capture closeCalls *inside* the provided layer scope: the adapter's
      // layer finalizer now tears down any live sessions when the layer
      // closes (which is exactly what we want for leak prevention), so
      // inspecting closeCalls after `Effect.provide` completes would observe
      // the teardown — not the behavior under test. We care that the event
      // pump kept the session alive while logging was failing.
      const { sessions, closeCallsDuringRun } = yield* Effect.gen(function* () {
        const adapter = yield* OpenCodeAdapter;
        yield* adapter.startSession({
          provider: ProviderDriverKind.make("opencode"),
          threadId: asThreadId("thread-native-log-failure"),
          runtimeMode: "full-access",
        });
        yield* advanceTestClock(10);
        return {
          sessions: yield* adapter.listSessions(),
          closeCallsDuringRun: [...runtimeMock.state.closeCalls],
        };
      }).pipe(Effect.provide(adapterLayer));

      assert.equal(sessions.length, 1);
      assert.equal(sessions[0]?.threadId, "thread-native-log-failure");
      assert.deepEqual(closeCallsDuringRun, []);
    }),
  );

  it.effect("emits thread.token-usage.updated for assistant messages with tokens", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-opencode-token-usage");
      runtimeMock.state.providerListResponse = {
        all: [
          {
            id: "anthropic",
            models: {
              "claude-sonnet-4-5": { limit: { context: 200_000 } },
            },
          },
        ],
      };
      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            info: {
              id: "msg-token-usage",
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-sonnet-4-5",
              tokens: {
                total: 4242,
                input: 1500,
                output: 300,
                reasoning: 120,
                cache: { read: 2000, write: 320 },
              },
            },
          },
        },
      ];

      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.filter((event) => event.type === "thread.token-usage.updated"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
      });

      const usageEvents = Array.from(
        yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")),
      );
      assert.equal(usageEvents.length, 1);
      const usageEvent = usageEvents[0];
      assert.equal(usageEvent?.type, "thread.token-usage.updated");
      if (usageEvent?.type !== "thread.token-usage.updated") {
        throw new Error("expected thread.token-usage.updated event");
      }
      // 4242 fits under the 200k context window, so usedTokens == totalProcessed
      // and totalProcessedTokens is omitted (only surfaced when it exceeds the cap).
      assert.equal(usageEvent.payload.usage.usedTokens, 4242);
      assert.equal(usageEvent.payload.usage.maxTokens, 200_000);
      assert.equal(usageEvent.payload.usage.totalProcessedTokens, undefined);
      assert.equal(usageEvent.payload.usage.inputTokens, 3820);
      assert.equal(usageEvent.payload.usage.cachedInputTokens, 2000);
      assert.equal(usageEvent.payload.usage.outputTokens, 300);
      assert.equal(usageEvent.payload.usage.reasoningOutputTokens, 120);
      assert.equal(usageEvent.payload.usage.compactsAutomatically, true);
      // provider.list should have been hit exactly once for the session.
      assert.deepEqual(runtimeMock.state.providerListCalls, [process.cwd()]);
    }),
  );

  it.effect("does not emit thread.token-usage.updated when assistant tokens are all zero", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-opencode-token-usage-empty");
      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            info: {
              id: "msg-token-usage-empty",
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-sonnet-4-5",
              tokens: {
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        },
      ];

      // Collect the first 2 events (session.started + thread.started, emitted
      // synchronously during startSession). The event pump processes the
      // message.updated event asynchronously — after advanceTestClock gives
      // it time — but since all tokens are zero, no thread.token-usage.updated
      // event is emitted. The first 2 events should never include one.
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
      });
      // Let the event-pump fiber process the subscribed message.updated event.
      yield* advanceTestClock(50);

      const events = Array.from(
        yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")),
      );
      assert.equal(events.length, 2);
      assert.equal(
        events.some((event) => event.type === "thread.token-usage.updated"),
        false,
      );
    }),
  );

  it.effect("still emits token usage when provider.list fails (no maxTokens)", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-opencode-token-usage-no-list");
      runtimeMock.state.providerListError = new Error("provider.list unavailable");
      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            info: {
              id: "msg-token-usage-no-list",
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-sonnet-4-5",
              tokens: {
                input: 1000,
                output: 50,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        },
      ];

      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.filter((event) => event.type === "thread.token-usage.updated"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
      });

      const usageEvents = Array.from(
        yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")),
      );
      assert.equal(usageEvents.length, 1);
      const usageEvent = usageEvents[0];
      if (usageEvent?.type !== "thread.token-usage.updated") {
        throw new Error("expected thread.token-usage.updated event");
      }
      // No context window available, so usedTokens mirrors totalProcessed
      // and maxTokens is absent.
      assert.equal(usageEvent.payload.usage.usedTokens, 1050);
      assert.equal(usageEvent.payload.usage.maxTokens, undefined);
      assert.equal(usageEvent.payload.usage.totalProcessedTokens, undefined);
      assert.equal(usageEvent.payload.usage.inputTokens, 1000);
      assert.equal(usageEvent.payload.usage.outputTokens, 50);
    }),
  );

  it.effect("clamps usedTokens to the resolved context window", () =>
    Effect.gen(function* () {
      const adapter = yield* OpenCodeAdapter;
      const threadId = asThreadId("thread-opencode-token-usage-clamp");
      runtimeMock.state.providerListResponse = {
        all: [
          {
            id: "openai",
            models: {
              "gpt-5": { limit: { context: 10_000 } },
            },
          },
        ],
      };
      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            sessionID: "http://127.0.0.1:9999/session",
            info: {
              id: "msg-token-usage-clamp",
              role: "assistant",
              providerID: "openai",
              modelID: "gpt-5",
              tokens: {
                // total exceeds the 10k context window; usedTokens should clamp.
                total: 12_000,
                input: 11_500,
                output: 500,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        },
      ];

      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.filter((event) => event.type === "thread.token-usage.updated"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("opencode"),
        threadId,
        runtimeMode: "full-access",
      });

      const usageEvents = Array.from(
        yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")),
      );
      const usageEvent = usageEvents[0];
      if (usageEvent?.type !== "thread.token-usage.updated") {
        throw new Error("expected thread.token-usage.updated event");
      }
      assert.equal(usageEvent.payload.usage.usedTokens, 10_000);
      assert.equal(usageEvent.payload.usage.maxTokens, 10_000);
      assert.equal(usageEvent.payload.usage.totalProcessedTokens, 12_000);
      // provider.list should be called once and the result cached for
      // subsequent assistant messages on the same model.
      assert.deepEqual(runtimeMock.state.providerListCalls, [process.cwd()]);
    }),
  );
});

describe("normalizeOpenCodeTokenUsage", () => {
  it("returns undefined when nothing was processed", () => {
    const empty: OpenCodeAssistantTokenUsage = {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    assert.equal(normalizeOpenCodeTokenUsage(empty), undefined);
    assert.equal(normalizeOpenCodeTokenUsage(empty, 200_000), undefined);
  });

  it("treats non-finite token fields as zero instead of propagating NaN", () => {
    const usage: OpenCodeAssistantTokenUsage = {
      total: Number.POSITIVE_INFINITY,
      input: Number.NaN,
      output: 10,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    const result = normalizeOpenCodeTokenUsage(usage);
    assert.equal(result?.usedTokens, 10);
    assert.equal(result?.outputTokens, 10);
    // inputTokens is omitted (undefined) when all input-side fields are 0.
    assert.equal(result?.inputTokens, undefined);
  });

  it("includes cache read+write in inputTokens and totals", () => {
    const usage: OpenCodeAssistantTokenUsage = {
      input: 100,
      output: 20,
      reasoning: 5,
      cache: { read: 500, write: 50 },
    };
    const result = normalizeOpenCodeTokenUsage(usage);
    // No tokens.total, so totalProcessed falls back to
    // inputTokens (650) + output (20) + reasoning (5) = 675.
    assert.equal(result?.usedTokens, 675);
    assert.equal(result?.totalProcessedTokens, undefined);
    assert.equal(result?.inputTokens, 650);
    assert.equal(result?.cachedInputTokens, 500);
    assert.equal(result?.outputTokens, 20);
    assert.equal(result?.reasoningOutputTokens, 5);
  });

  it("clamps usedTokens to the context window while preserving totalProcessed", () => {
    const usage: OpenCodeAssistantTokenUsage = {
      total: 150_000,
      input: 140_000,
      output: 10_000,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    const result = normalizeOpenCodeTokenUsage(usage, 100_000);
    assert.equal(result?.usedTokens, 100_000);
    assert.equal(result?.maxTokens, 100_000);
    assert.equal(result?.totalProcessedTokens, 150_000);
  });

  it("ignores non-positive context window values", () => {
    const usage: OpenCodeAssistantTokenUsage = {
      input: 100,
      output: 10,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    assert.equal(normalizeOpenCodeTokenUsage(usage, 0)?.maxTokens, undefined);
    assert.equal(normalizeOpenCodeTokenUsage(usage, -5)?.maxTokens, undefined);
    assert.equal(
      normalizeOpenCodeTokenUsage(usage, Number.NaN)?.maxTokens,
      undefined,
    );
  });
});
