{
  description = "t3code fork";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        desktopRuntimeLibs = pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
          alsa-lib
          atk
          cairo
          dbus
          expat
          glib
          gtk3
          libdrm
          libgbm
          libsecret
          libx11
          libxcomposite
          libxcursor
          libxdamage
          libxext
          libxfixes
          libxi
          libxrandr
          libxrender
          libxscrnsaver
          libxtst
          libxcb
          mesa
          nspr
          nss
          pango
        ]);
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bash
            bun
            coreutils
            codex
            electron_40
            gcc
            git
            nodejs_24
            pkg-config
            python3
          ] ++ desktopRuntimeLibs;

          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath desktopRuntimeLibs;
          ELECTRON_OVERRIDE_DIST_PATH = pkgs.lib.optionalString pkgs.stdenv.isLinux "${pkgs.electron_40}/bin";

          shellHook = ''
            echo "t3code-nix dev shell"
            echo "Run: bun install --frozen-lockfile"
            echo "Then: bun run dev"
          '';
        };

        formatter = pkgs.nixpkgs-fmt;

        checks.flake-eval = pkgs.runCommand "t3code-nix-flake-eval" {} ''
          mkdir -p "$out"
        '';
      });
}
