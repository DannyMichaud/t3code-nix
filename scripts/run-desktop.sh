#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./dev-profile.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-profile.sh"

ROOT_DIR="$(t3code_root_dir)"
DEV_PROFILE_PATH="$(t3code_dev_profile_path)"
FORWARD_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
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

if [[ -z "${T3CODE_DESKTOP_RUN_INNER:-}" ]]; then
  t3code_ensure_dev_profile "$ROOT_DIR" "$DEV_PROFILE_PATH"
  export T3CODE_DESKTOP_RUN_INNER=1
  exec nix develop "$DEV_PROFILE_PATH" --command bash "$ROOT_DIR/scripts/run-desktop.sh" "${FORWARD_ARGS[@]}"
fi

cd "$ROOT_DIR"

if [[ ! -f "apps/desktop/dist-electron/main.js" ]] || \
   [[ ! -f "apps/desktop/dist-electron/preload.js" ]] || \
   [[ ! -f "apps/server/dist/bin.mjs" ]] || \
   { [[ ! -f "apps/server/dist/client/index.html" ]] && [[ ! -f "apps/web/dist/index.html" ]]; }; then
  echo "Building desktop runtime artifacts for non-dev launch"
  bun run build --filter=@t3tools/web --filter=@t3tools/desktop --filter=t3
fi

export T3CODE_DEVICE_SCALE_FACTOR="${T3CODE_DEVICE_SCALE_FACTOR:-1.25}"

echo "Launching t3code desktop from built artifacts"
exec bun run start:desktop -- "${FORWARD_ARGS[@]}"
