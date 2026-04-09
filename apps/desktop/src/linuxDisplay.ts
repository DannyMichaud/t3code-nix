import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

export type LinuxWaylandEnvironment = {
  readonly WAYLAND_DISPLAY: string;
  readonly XDG_RUNTIME_DIR: string;
  readonly XDG_SESSION_TYPE: "wayland";
};

type ResolveLinuxWaylandEnvironmentOptions = {
  readonly platform?: NodeJS.Platform;
};

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveRuntimeDir(env: NodeJS.ProcessEnv): string | undefined {
  const runtimeDir = normalizeEnvValue(env.XDG_RUNTIME_DIR);
  if (runtimeDir) {
    return runtimeDir;
  }

  try {
    return Path.join("/run/user", String(OS.userInfo().uid));
  } catch {
    return undefined;
  }
}

function isExistingUnixSocket(path: string): boolean {
  try {
    return FS.statSync(path).isSocket();
  } catch {
    return false;
  }
}

function isValidWaylandDisplay(runtimeDir: string, displayName: string): boolean {
  return isExistingUnixSocket(Path.join(runtimeDir, displayName));
}

function parseHyprlandLockFile(lockFilePath: string): string | undefined {
  try {
    const lines = FS.readFileSync(lockFilePath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const socketName = lines[1];
    return normalizeEnvValue(socketName);
  } catch {
    return undefined;
  }
}

function resolveHyprlandWaylandDisplay(
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
): string | undefined {
  const hyprRuntimeDir = Path.join(runtimeDir, "hypr");
  const instanceSignature = normalizeEnvValue(env.HYPRLAND_INSTANCE_SIGNATURE);

  if (instanceSignature) {
    const socketName = parseHyprlandLockFile(
      Path.join(hyprRuntimeDir, instanceSignature, "hyprland.lock"),
    );
    if (socketName && isValidWaylandDisplay(runtimeDir, socketName)) {
      return socketName;
    }
  }

  let entries: ReadonlyArray<FS.Dirent>;
  try {
    entries = FS.readdirSync(hyprRuntimeDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const candidates = Array.from(
    new Set(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          parseHyprlandLockFile(Path.join(hyprRuntimeDir, entry.name, "hyprland.lock")),
        )
        .filter((socketName): socketName is string =>
          Boolean(socketName && isValidWaylandDisplay(runtimeDir, socketName)),
        ),
    ),
  );

  if (candidates.length !== 1) {
    return undefined;
  }

  return candidates[0];
}

function resolveSingleWaylandDisplay(runtimeDir: string): string | undefined {
  let entries: ReadonlyArray<FS.Dirent>;
  try {
    entries = FS.readdirSync(runtimeDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const candidates = entries
    .filter((entry) => entry.name.startsWith("wayland-"))
    .map((entry) => entry.name)
    .filter((socketName) => isValidWaylandDisplay(runtimeDir, socketName));

  if (candidates.length !== 1) {
    return undefined;
  }

  return candidates[0];
}

export function resolveLinuxWaylandEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveLinuxWaylandEnvironmentOptions = {},
): LinuxWaylandEnvironment | null {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") {
    return null;
  }

  const runtimeDir = resolveRuntimeDir(env);
  if (!runtimeDir) {
    return null;
  }

  const inheritedWaylandDisplay = normalizeEnvValue(env.WAYLAND_DISPLAY);
  if (inheritedWaylandDisplay && isValidWaylandDisplay(runtimeDir, inheritedWaylandDisplay)) {
    return {
      WAYLAND_DISPLAY: inheritedWaylandDisplay,
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_SESSION_TYPE: "wayland",
    };
  }

  const hyprlandWaylandDisplay = resolveHyprlandWaylandDisplay(env, runtimeDir);
  if (hyprlandWaylandDisplay) {
    return {
      WAYLAND_DISPLAY: hyprlandWaylandDisplay,
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_SESSION_TYPE: "wayland",
    };
  }

  const sessionType = normalizeEnvValue(env.XDG_SESSION_TYPE)?.toLowerCase();
  if (sessionType !== "wayland") {
    return null;
  }

  const fallbackWaylandDisplay = resolveSingleWaylandDisplay(runtimeDir);
  if (!fallbackWaylandDisplay) {
    return null;
  }

  return {
    WAYLAND_DISPLAY: fallbackWaylandDisplay,
    XDG_RUNTIME_DIR: runtimeDir,
    XDG_SESSION_TYPE: "wayland",
  };
}
