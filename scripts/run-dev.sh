#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./dev-profile.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-profile.sh"

ROOT_DIR="$(t3code_root_dir)"
DEV_PROFILE_PATH="$(t3code_dev_profile_path)"
MODE="${T3CODE_DEV_MODE:-}"

if [[ $# -gt 0 ]]; then
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
  esac
fi

if [[ -z "${T3CODE_DEV_RUN_INNER:-}" ]]; then
  t3code_ensure_dev_profile "$ROOT_DIR" "$DEV_PROFILE_PATH"
  export T3CODE_DEV_RUN_INNER=1
  if [[ -n "$MODE" ]]; then
    export T3CODE_DEV_MODE="$MODE"
  fi
  exec nix develop "$DEV_PROFILE_PATH" --command bash "$ROOT_DIR/scripts/run-dev.sh" "$@"
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
exec bun run "$MODE" "$@"
