export interface DesktopBackendBootstrapConfig {
  readonly cwd?: string;
  readonly autoBootstrapProjectFromCwd?: boolean;
}

interface ResolveDesktopBackendBootstrapConfigInput {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBooleanish(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function readSwitchValue(argv: ReadonlyArray<string>, switchName: string): string | undefined {
  const prefix = `--${switchName}`;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === prefix) {
      return argv[index + 1];
    }
    if (argument?.startsWith(`${prefix}=`)) {
      return argument.slice(prefix.length + 1);
    }
  }

  return undefined;
}

function readBooleanSwitch(argv: ReadonlyArray<string>, switchName: string): boolean | undefined {
  const positive = `--${switchName}`;
  const negative = `--no-${switchName}`;

  for (const argument of argv) {
    if (argument === negative) {
      return false;
    }
    if (argument === positive) {
      return true;
    }
    if (argument.startsWith(`${positive}=`)) {
      return parseBooleanish(argument.slice(positive.length + 1));
    }
  }

  return undefined;
}

export function resolveDesktopBackendBootstrapConfig(
  input: ResolveDesktopBackendBootstrapConfigInput = {},
): DesktopBackendBootstrapConfig {
  const argv = input.argv ?? process.argv;
  const env = input.env ?? process.env;

  const cwd =
    normalizeOptionalString(readSwitchValue(argv, "cwd")) ??
    normalizeOptionalString(env.T3CODE_DESKTOP_CWD) ??
    normalizeOptionalString(env.T3CODE_CWD);

  const autoBootstrapProjectFromCwd =
    readBooleanSwitch(argv, "auto-bootstrap-project-from-cwd") ??
    parseBooleanish(env.T3CODE_DESKTOP_AUTO_BOOTSTRAP_PROJECT_FROM_CWD) ??
    parseBooleanish(env.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD) ??
    (cwd !== undefined ? true : undefined);

  return {
    ...(cwd ? { cwd } : {}),
    ...(autoBootstrapProjectFromCwd !== undefined ? { autoBootstrapProjectFromCwd } : {}),
  };
}
