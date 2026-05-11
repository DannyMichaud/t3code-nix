// @effect-diagnostics nodeBuiltinImport:off
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

interface ResolveDesktopUserDataPathInput {
  readonly baseDir?: string | undefined;
  readonly isDevelopment?: boolean;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly pathExists?: (path: string) => boolean;
}

const DEFAULT_BASE_DIR_NAME = ".t3";

function resolveAppDataBase(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string {
  if (platform === "win32") {
    return env.APPDATA || Path.join(homeDir, "AppData", "Roaming");
  }

  if (platform === "darwin") {
    return Path.join(homeDir, "Library", "Application Support");
  }

  return env.XDG_CONFIG_HOME || Path.join(homeDir, ".config");
}

export function resolveDesktopUserDataPath(input: ResolveDesktopUserDataPathInput = {}): string {
  const baseDir = input.baseDir?.trim();
  const homeDir = input.homeDir ?? OS.homedir();
  const defaultBaseDir = Path.join(homeDir, DEFAULT_BASE_DIR_NAME);

  if (baseDir && Path.resolve(baseDir) !== Path.resolve(defaultBaseDir)) {
    return Path.join(baseDir, "userdata");
  }

  const isDevelopment = input.isDevelopment ?? false;
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const pathExists = input.pathExists ?? FS.existsSync;
  const appDataBase = resolveAppDataBase(platform, env, homeDir);
  const legacyDirName = isDevelopment ? "T3 Code (Dev)" : "T3 Code (Alpha)";
  const userDataDirName = isDevelopment ? "t3code-dev" : "t3code";
  const legacyPath = Path.join(appDataBase, legacyDirName);

  if (pathExists(legacyPath)) {
    return legacyPath;
  }

  return Path.join(appDataBase, userDataDirName);
}
