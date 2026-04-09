#!/usr/bin/env bash

t3code_root_dir() {
  (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
}

t3code_dev_profile_path() {
  local state_home
  state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
  printf '%s\n' "${T3CODE_DEV_PROFILE_PATH:-$state_home/nix/profiles/t3code-dev-shell}"
}

t3code_ensure_dev_profile() {
  local root_dir profile_path
  root_dir="${1:-$(t3code_root_dir)}"
  profile_path="${2:-$(t3code_dev_profile_path)}"

  mkdir -p "$(dirname "$profile_path")"
  nix develop "path:$root_dir" --profile "$profile_path" --command true >/dev/null
}
