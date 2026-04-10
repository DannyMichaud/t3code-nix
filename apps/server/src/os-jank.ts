import * as OS from "node:os";
import { Effect, Path } from "effect";
import { resolveLinuxWaylandEnvironment } from "@t3tools/shared/linuxDisplay";
import {
  type ShellEnvironmentReader,
  syncShellEnvironmentFromLoginShell,
} from "@t3tools/shared/shell";

export function fixPath(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    readEnvironment?: ShellEnvironmentReader;
  } = {},
): void {
  const env = options.env ?? process.env;
  syncShellEnvironmentFromLoginShell(env, {
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.readEnvironment !== undefined ? { readEnvironment: options.readEnvironment } : {}),
  });
  const linuxWaylandOptions =
    options.platform === undefined ? undefined : { platform: options.platform };
  const linuxWaylandEnvironment = resolveLinuxWaylandEnvironment(env, linuxWaylandOptions);
  if (linuxWaylandEnvironment) {
    Object.assign(env, linuxWaylandEnvironment);
  }
}

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(OS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(OS.homedir(), ".t3");
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
