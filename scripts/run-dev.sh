#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./dev-profile.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-profile.sh"

ROOT_DIR="$(t3code_root_dir)"
DEV_PROFILE_PATH="$(t3code_dev_profile_path)"
MODE="${T3CODE_DEV_MODE:-}"
FORWARD_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --desktop)
      MODE="dev:desktop"
      shift
      ;;
    --server)
      MODE="dev:server"
      shift
      ;;
    --web)
      MODE="dev:web"
      shift
      ;;
    --cwd)
      if [[ -z "${2:-}" ]]; then
        echo "Missing value for --cwd" >&2
        exit 1
      fi
      export T3CODE_DESKTOP_CWD="$2"
      shift 2
      ;;
    --auto-bootstrap-project-from-cwd)
      export T3CODE_DESKTOP_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=1
      shift
      ;;
    --no-auto-bootstrap-project-from-cwd)
      export T3CODE_DESKTOP_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=0
      shift
      ;;
    *)
      FORWARD_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "${T3CODE_DEV_RUN_INNER:-}" ]]; then
  t3code_ensure_dev_profile "$ROOT_DIR" "$DEV_PROFILE_PATH"
  export T3CODE_DEV_RUN_INNER=1
  if [[ -n "$MODE" ]]; then
    export T3CODE_DEV_MODE="$MODE"
  fi
  exec nix develop "$DEV_PROFILE_PATH" --command bash "$ROOT_DIR/scripts/run-dev.sh" "${FORWARD_ARGS[@]}"
fi

cd "$ROOT_DIR"

if [[ -z "$MODE" ]]; then
  MODE="$(t3code_default_dev_mode)"
fi

if [[ "$MODE" == "dev:desktop" ]]; then
  export T3CODE_THEME_SOURCE="${T3CODE_THEME_SOURCE:-dark}"
  export T3CODE_FORCE_THEME="${T3CODE_FORCE_THEME:-dark}"
  export T3CODE_DEVICE_SCALE_FACTOR="${T3CODE_DEVICE_SCALE_FACTOR:-1.25}"
fi

echo "Launching t3code via bun run ${MODE} (persisted dev shell)"
exec bun run "$MODE" -- "${FORWARD_ARGS[@]}"
