import * as FS from "node:fs/promises";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fixPath } from "./os-jank";

const runtimeDirs = new Set<string>();
const socketServers = new Set<Net.Server>();

async function createUnixSocket(socketPath: string): Promise<void> {
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
  const runtimeDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "t3code-os-jank-"));
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

describe("fixPath", () => {
  it("hydrates PATH and missing SSH_AUTH_SOCK on linux using the resolved login shell", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/secretive.sock",
    }));

    fixPath({
      env,
      platform: "linux",
      readEnvironment,
    });

    expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", ["PATH", "SHELL", "SSH_AUTH_SOCK"]);
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/secretive.sock");
  });

  it("does nothing outside macOS and linux even when SHELL is set", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "C:/Program Files/Git/bin/bash.exe",
      PATH: "C:\\Windows\\System32",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/usr/local/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/secretive.sock",
    }));

    fixPath({
      env,
      platform: "win32",
      readEnvironment,
    });

    expect(readEnvironment).not.toHaveBeenCalled();
    expect(env.PATH).toBe("C:\\Windows\\System32");
  });

  it("recovers the active Hyprland instance signature for linux server sessions", async () => {
    const runtimeDir = await makeRuntimeDir();
    const hyprRuntimeDir = Path.join(runtimeDir, "hypr", "instance-a");
    await FS.mkdir(hyprRuntimeDir, { recursive: true });
    await FS.writeFile(Path.join(hyprRuntimeDir, "hyprland.lock"), "2554\nwayland-1\n");
    await createUnixSocket(Path.join(hyprRuntimeDir, ".socket.sock"));
    await createUnixSocket(Path.join(runtimeDir, "wayland-1"));

    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      WAYLAND_DISPLAY: "wayland-1",
      XDG_RUNTIME_DIR: runtimeDir,
    };

    fixPath({
      env,
      platform: "linux",
      readEnvironment: () => ({
        PATH: "/usr/bin",
      }),
    });

    expect(env.HYPRLAND_INSTANCE_SIGNATURE).toBe("instance-a");
    expect(env.WAYLAND_DISPLAY).toBe("wayland-1");
    expect(env.XDG_SESSION_TYPE).toBe("wayland");
  });
});
