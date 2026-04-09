#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./dev-profile.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-profile.sh"

ROOT_DIR="$(t3code_root_dir)"
DEV_PROFILE_PATH="$(t3code_dev_profile_path)"

t3code_ensure_dev_profile "$ROOT_DIR" "$DEV_PROFILE_PATH"

if [[ $# -eq 0 ]]; then
  exec nix develop "$DEV_PROFILE_PATH"
fi

exec nix develop "$DEV_PROFILE_PATH" "$@"
