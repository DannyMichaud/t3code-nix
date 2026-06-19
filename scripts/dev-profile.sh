#!/usr/bin/env bash

t3code_root_dir() {
  (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
}

t3code_dev_profile_path() {
  local state_home
  state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
  printf '%s\n' "${T3CODE_DEV_PROFILE_PATH:-$state_home/nix/profiles/t3code-dev-shell}"
}

t3code_file_hash() {
  local file hash_output
  file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    hash_output="$(sha256sum "$file")"
    printf '%s\n' "${hash_output%% *}"
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    hash_output="$(shasum -a 256 "$file")"
    printf '%s\n' "${hash_output%% *}"
    return
  fi

  nix hash file --type sha256 "$file"
}

t3code_dev_profile_fingerprint() {
  local root_dir file label
  root_dir="${1:-$(t3code_root_dir)}"

  for file in "$root_dir/flake.nix" "$root_dir/flake.lock"; do
    label="${file#"$root_dir"/}"
    if [[ -f "$file" ]]; then
      printf '%s  %s\n' "$(t3code_file_hash "$file")" "$label"
    else
      printf 'missing  %s\n' "$label"
    fi
  done
}

t3code_dev_profile_stamp_path() {
  local profile_path
  profile_path="${1:-$(t3code_dev_profile_path)}"
  printf '%s\n' "$profile_path.fingerprint"
}

t3code_is_wayland_session() {
  [[ "$(uname -s)" == "Linux" ]] || return 1

  if [[ "${XDG_SESSION_TYPE:-}" =~ ^[Ww][Aa][Yy][Ll][Aa][Nn][Dd]$ ]]; then
    return 0
  fi

  [[ -n "${WAYLAND_DISPLAY:-}" ]]
}

t3code_default_dev_mode() {
  if t3code_is_wayland_session; then
    printf '%s\n' "dev:desktop"
    return
  fi

  printf '%s\n' "dev"
}

t3code_ensure_dev_profile() {
  local root_dir profile_path stamp_path fingerprint
  root_dir="${1:-$(t3code_root_dir)}"
  profile_path="${2:-$(t3code_dev_profile_path)}"
  stamp_path="$(t3code_dev_profile_stamp_path "$profile_path")"
  fingerprint="$(t3code_dev_profile_fingerprint "$root_dir")"

  mkdir -p "$(dirname "$profile_path")"

  if [[ "${T3CODE_REFRESH_DEV_PROFILE:-0}" != "1" ]] &&
     [[ -e "$profile_path" ]] &&
     [[ -f "$stamp_path" ]] &&
     [[ "$(cat "$stamp_path")" == "$fingerprint" ]]; then
    return 0
  fi

  nix develop "path:$root_dir" --profile "$profile_path" --command true >/dev/null
  printf '%s\n' "$fingerprint" > "$stamp_path"
}
