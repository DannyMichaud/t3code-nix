import * as FS from "node:fs/promises";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveLinuxWaylandEnvironment } from "./linuxDisplay";

const runtimeDirs = new Set<string>();
const socketServers = new Set<Net.Server>();

async function createWaylandSocket(socketPath: string): Promise<void> {
  await FS.mkdir(Path.dirname(socketPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const server = Net.createServer();
    server.once("error", reject);
    server.listen(socketPath, () => {
      socketServers.add(server);
      resolve();
    });
  });
}

async function makeRuntimeDir(): Promise<string> {
  const runtimeDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "t3code-wayland-"));
  runtimeDirs.add(runtimeDir);
  return runtimeDir;
}

afterEach(async () => {
  for (const server of socketServers) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
  socketServers.clear();

  for (const runtimeDir of runtimeDirs) {
    await FS.rm(runtimeDir, { recursive: true, force: true });
  }
  runtimeDirs.clear();
});

describe("resolveLinuxWaylandEnvironment", () => {
  it("keeps an inherited wayland socket when it is still valid", async () => {
    const runtimeDir = await makeRuntimeDir();
    const socketPath = Path.join(runtimeDir, "wayland-4");
    await createWaylandSocket(socketPath);

    expect(
      resolveLinuxWaylandEnvironment(
        {
          WAYLAND_DISPLAY: "wayland-4",
          XDG_RUNTIME_DIR: runtimeDir,
        },
        { platform: "linux" },
      ),
    ).toEqual({
      WAYLAND_DISPLAY: "wayland-4",
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_SESSION_TYPE: "wayland",
    });
  });

  it("recovers the active wayland socket from the current Hyprland instance lock", async () => {
    const runtimeDir = await makeRuntimeDir();
    const hyprRuntimeDir = Path.join(runtimeDir, "hypr", "instance-a");
    await FS.mkdir(hyprRuntimeDir, { recursive: true });
    await FS.writeFile(Path.join(hyprRuntimeDir, "hyprland.lock"), "2554\nwayland-1\n");

    await createWaylandSocket(Path.join(runtimeDir, "wayland-1"));

    expect(
      resolveLinuxWaylandEnvironment(
        {
          HYPRLAND_INSTANCE_SIGNATURE: "instance-a",
          XDG_RUNTIME_DIR: runtimeDir,
        },
        { platform: "linux" },
      ),
    ).toEqual({
      WAYLAND_DISPLAY: "wayland-1",
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_SESSION_TYPE: "wayland",
    });
  });

  it("falls back to a single Hyprland instance when the signature is missing", async () => {
    const runtimeDir = await makeRuntimeDir();
    const hyprRuntimeDir = Path.join(runtimeDir, "hypr", "instance-a");
    await FS.mkdir(hyprRuntimeDir, { recursive: true });
    await FS.writeFile(Path.join(hyprRuntimeDir, "hyprland.lock"), "2554\nwayland-8\n");

    await createWaylandSocket(Path.join(runtimeDir, "wayland-8"));

    expect(
      resolveLinuxWaylandEnvironment(
        {
          XDG_RUNTIME_DIR: runtimeDir,
        },
        { platform: "linux" },
      ),
    ).toEqual({
      WAYLAND_DISPLAY: "wayland-8",
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_SESSION_TYPE: "wayland",
    });
  });

  it("deduplicates duplicate Hyprland lockfiles that point at the same socket", async () => {
    const runtimeDir = await makeRuntimeDir();
    const firstHyprRuntimeDir = Path.join(runtimeDir, "hypr", "instance-a");
    const secondHyprRuntimeDir = Path.join(runtimeDir, "hypr", "instance-b");
    await FS.mkdir(firstHyprRuntimeDir, { recursive: true });
    await FS.mkdir(secondHyprRuntimeDir, { recursive: true });
    await FS.writeFile(Path.join(firstHyprRuntimeDir, "hyprland.lock"), "2554\nwayland-1\n");
    await FS.writeFile(Path.join(secondHyprRuntimeDir, "hyprland.lock"), "859777\nwayland-1\n");

    await createWaylandSocket(Path.join(runtimeDir, "wayland-1"));

    expect(
      resolveLinuxWaylandEnvironment(
        {
          XDG_RUNTIME_DIR: runtimeDir,
        },
        { platform: "linux" },
      ),
    ).toEqual({
      WAYLAND_DISPLAY: "wayland-1",
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_SESSION_TYPE: "wayland",
    });
  });

  it("uses the single available wayland socket when the session is wayland", async () => {
    const runtimeDir = await makeRuntimeDir();
    await createWaylandSocket(Path.join(runtimeDir, "wayland-2"));

    expect(
      resolveLinuxWaylandEnvironment(
        {
          XDG_RUNTIME_DIR: runtimeDir,
          XDG_SESSION_TYPE: "wayland",
        },
        { platform: "linux" },
      ),
    ).toEqual({
      WAYLAND_DISPLAY: "wayland-2",
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_SESSION_TYPE: "wayland",
    });
  });
});
