// @effect-diagnostics nodeBuiltinImport:off
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

export type LinuxWaylandEnvironment = {
  readonly WAYLAND_DISPLAY: string;
  readonly XDG_RUNTIME_DIR: string;
  readonly XDG_SESSION_TYPE: "wayland";
  readonly HYPRLAND_INSTANCE_SIGNATURE?: string;
};

type ResolveLinuxWaylandEnvironmentOptions = {
  readonly platform?: NodeJS.Platform;
};

interface HyprlandInstance {
  readonly signature: string;
  readonly socketName: string;
  readonly controllable: boolean;
}

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

function readValidHyprlandInstances(runtimeDir: string): ReadonlyArray<HyprlandInstance> {
  const hyprRuntimeDir = Path.join(runtimeDir, "hypr");

  let entries: ReadonlyArray<FS.Dirent>;
  try {
    entries = FS.readdirSync(hyprRuntimeDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const instanceDir = Path.join(hyprRuntimeDir, entry.name);
      const socketName = parseHyprlandLockFile(Path.join(instanceDir, "hyprland.lock"));
      if (!socketName || !isValidWaylandDisplay(runtimeDir, socketName)) {
        return null;
      }

      return {
        signature: entry.name,
        socketName,
        controllable: isExistingUnixSocket(Path.join(instanceDir, ".socket.sock")),
      } satisfies HyprlandInstance;
    })
    .filter((instance): instance is HyprlandInstance => instance !== null);
}

function resolveHyprlandWaylandDisplay(
  env: NodeJS.ProcessEnv,
  instances: ReadonlyArray<HyprlandInstance>,
): string | undefined {
  const instanceSignature = normalizeEnvValue(env.HYPRLAND_INSTANCE_SIGNATURE);
  if (instanceSignature) {
    const matchingInstance = instances.find((instance) => instance.signature === instanceSignature);
    if (matchingInstance) {
      return matchingInstance.socketName;
    }
  }

  const candidates = Array.from(new Set(instances.map((instance) => instance.socketName)));
  if (candidates.length !== 1) {
    return undefined;
  }

  return candidates[0];
}

function resolveHyprlandInstanceSignature(
  env: NodeJS.ProcessEnv,
  instances: ReadonlyArray<HyprlandInstance>,
  inheritedWaylandDisplay: string | undefined,
): string | undefined {
  const preferredSignature = normalizeEnvValue(env.HYPRLAND_INSTANCE_SIGNATURE);
  if (preferredSignature) {
    const preferredInstance = instances.find(
      (instance) => instance.signature === preferredSignature && instance.controllable,
    );
    if (
      preferredInstance &&
      (inheritedWaylandDisplay === undefined ||
        preferredInstance.socketName === inheritedWaylandDisplay)
    ) {
      return preferredInstance.signature;
    }
  }

  if (inheritedWaylandDisplay) {
    const matchingInstances = instances.filter(
      (instance) => instance.controllable && instance.socketName === inheritedWaylandDisplay,
    );
    if (matchingInstances.length === 1) {
      return matchingInstances[0]?.signature;
    }
    return undefined;
  }

  const controllableInstances = instances.filter((instance) => instance.controllable);
  if (controllableInstances.length !== 1) {
    return undefined;
  }

  return controllableInstances[0]?.signature;
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

function buildLinuxWaylandEnvironment(
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
  waylandDisplay: string,
  hyprlandInstanceSignature: string | undefined,
): LinuxWaylandEnvironment {
  return {
    WAYLAND_DISPLAY: waylandDisplay,
    XDG_RUNTIME_DIR: runtimeDir,
    XDG_SESSION_TYPE: "wayland",
    ...(hyprlandInstanceSignature
      ? { HYPRLAND_INSTANCE_SIGNATURE: hyprlandInstanceSignature }
      : {}),
  };
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

  const hyprlandInstances = readValidHyprlandInstances(runtimeDir);
  const inheritedWaylandDisplay = normalizeEnvValue(env.WAYLAND_DISPLAY);
  if (inheritedWaylandDisplay && isValidWaylandDisplay(runtimeDir, inheritedWaylandDisplay)) {
    return buildLinuxWaylandEnvironment(
      env,
      runtimeDir,
      inheritedWaylandDisplay,
      resolveHyprlandInstanceSignature(env, hyprlandInstances, inheritedWaylandDisplay),
    );
  }

  const hyprlandWaylandDisplay = resolveHyprlandWaylandDisplay(env, hyprlandInstances);
  if (hyprlandWaylandDisplay) {
    return buildLinuxWaylandEnvironment(
      env,
      runtimeDir,
      hyprlandWaylandDisplay,
      resolveHyprlandInstanceSignature(env, hyprlandInstances, hyprlandWaylandDisplay),
    );
  }

  const sessionType = normalizeEnvValue(env.XDG_SESSION_TYPE)?.toLowerCase();
  if (sessionType !== "wayland") {
    return null;
  }

  const fallbackWaylandDisplay = resolveSingleWaylandDisplay(runtimeDir);
  if (!fallbackWaylandDisplay) {
    return null;
  }

  return buildLinuxWaylandEnvironment(
    env,
    runtimeDir,
    fallbackWaylandDisplay,
    resolveHyprlandInstanceSignature(env, hyprlandInstances, fallbackWaylandDisplay),
  );
}
