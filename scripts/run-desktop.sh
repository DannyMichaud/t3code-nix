#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./dev-profile.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-profile.sh"

ROOT_DIR="$(t3code_root_dir)"
DEV_PROFILE_PATH="$(t3code_dev_profile_path)"

if [[ -z "${T3CODE_DESKTOP_RUN_INNER:-}" ]]; then
  t3code_ensure_dev_profile "$ROOT_DIR" "$DEV_PROFILE_PATH"
  export T3CODE_DESKTOP_RUN_INNER=1
  exec nix develop "$DEV_PROFILE_PATH" --command bash "$ROOT_DIR/scripts/run-desktop.sh" "$@"
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
exec bun run start:desktop "$@"
