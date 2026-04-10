import {
  type ShellEnvironmentReader,
  syncShellEnvironmentFromLoginShell,
} from "@t3tools/shared/shell";

export function syncShellEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    platform?: NodeJS.Platform;
    readEnvironment?: ShellEnvironmentReader;
  } = {},
): void {
  syncShellEnvironmentFromLoginShell(env, {
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.readEnvironment !== undefined ? { readEnvironment: options.readEnvironment } : {}),
  });
}
