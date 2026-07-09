import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Electron from "electron";
import { afterEach, beforeEach, vi } from "vite-plus/test";

const { appFocusMock, getAllWindowsMock } = vi.hoisted(() => ({
  appFocusMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    focus: appFocusMock,
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
}));

import * as ElectronWindow from "./ElectronWindow.ts";

function makeBrowserWindow(input: {
  readonly destroyed?: boolean;
  readonly minimized?: boolean;
  readonly visible?: boolean;
}) {
  return {
    isDestroyed: vi.fn(() => input.destroyed ?? false),
    isMinimized: vi.fn(() => input.minimized ?? false),
    isVisible: vi.fn(() => input.visible ?? true),
    restore: vi.fn(),
    show: vi.fn(),
    showInactive: vi.fn(),
    focus: vi.fn(),
  } as unknown as Electron.BrowserWindow;
}

describe("ElectronWindow", () => {
  let originalPlatform: string;

  beforeEach(() => {
    appFocusMock.mockReset();
    getAllWindowsMock.mockReset();
    originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
  });

  it.effect("skips windows destroyed before appearance sync runs", () =>
    Effect.gen(function* () {
      const liveWindow = makeBrowserWindow({ destroyed: false });
      const destroyedWindow = makeBrowserWindow({ destroyed: true });
      getAllWindowsMock.mockReturnValue([destroyedWindow, liveWindow]);

      const syncedWindows: Electron.BrowserWindow[] = [];
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      yield* electronWindow.syncAllAppearance((window) =>
        Effect.sync(() => {
          syncedWindows.push(window);
        }),
      );

      assert.deepEqual(syncedWindows, [liveWindow]);
    }).pipe(Effect.provide(ElectronWindow.layer)),
  );

  it.effect("leaves an already-visible window without re-presenting or demanding focus", () =>
    Effect.gen(function* () {
      const window = makeBrowserWindow({ minimized: false, visible: true });
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      yield* electronWindow.reveal(window);

      assert.strictEqual((window.restore as ReturnType<typeof vi.fn>).mock.calls.length, 0);
      assert.strictEqual((window.show as ReturnType<typeof vi.fn>).mock.calls.length, 0);
      assert.strictEqual((window.showInactive as ReturnType<typeof vi.fn>).mock.calls.length, 0);
      assert.strictEqual((window.focus as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    }).pipe(Effect.provide(ElectronWindow.layer)),
  );

  it.effect("restores minimized windows and presents hidden windows without demanding focus", () =>
    Effect.gen(function* () {
      const minimizedWindow = makeBrowserWindow({ minimized: true, visible: true });
      const hiddenWindow = makeBrowserWindow({ minimized: false, visible: false });
      const electronWindow = yield* ElectronWindow.ElectronWindow;

      yield* electronWindow.reveal(minimizedWindow);
      yield* electronWindow.reveal(hiddenWindow);

      assert.strictEqual(
        (minimizedWindow.restore as ReturnType<typeof vi.fn>).mock.calls.length,
        1,
      );
      assert.strictEqual((minimizedWindow.showInactive as ReturnType<typeof vi.fn>).mock.calls.length, 0);
      assert.strictEqual((minimizedWindow.focus as ReturnType<typeof vi.fn>).mock.calls.length, 0);
      assert.strictEqual((hiddenWindow.showInactive as ReturnType<typeof vi.fn>).mock.calls.length, 1);
      assert.strictEqual((hiddenWindow.show as ReturnType<typeof vi.fn>).mock.calls.length, 0);
      assert.strictEqual((hiddenWindow.focus as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    }).pipe(Effect.provide(ElectronWindow.layer)),
  );

  it.effect("still demands focus on macOS to activate the app", () =>
    Effect.gen(function* () {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
        writable: true,
      });
      const window = makeBrowserWindow({ minimized: false, visible: false });
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      yield* electronWindow.reveal(window);

      assert.strictEqual((window.show as ReturnType<typeof vi.fn>).mock.calls.length, 1);
      assert.strictEqual((window.focus as ReturnType<typeof vi.fn>).mock.calls.length, 1);
      assert.strictEqual(appFocusMock.mock.calls.length, 1);
    }).pipe(Effect.provide(ElectronWindow.layer)),
  );
});
