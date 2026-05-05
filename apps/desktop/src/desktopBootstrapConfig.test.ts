import { describe, expect, it } from "vitest";

import { resolveDesktopBackendBootstrapConfig } from "./desktopBootstrapConfig.js";

describe("resolveDesktopBackendBootstrapConfig", () => {
  it("enables project auto-bootstrap when a cwd is supplied via env", () => {
    expect(
      resolveDesktopBackendBootstrapConfig({
        argv: ["t3code"],
        env: { T3CODE_DESKTOP_CWD: "  /tmp/research-project  " },
      }),
    ).toEqual({
      cwd: "/tmp/research-project",
      autoBootstrapProjectFromCwd: true,
    });
  });

  it("lets explicit argv overrides win over env defaults", () => {
    expect(
      resolveDesktopBackendBootstrapConfig({
        argv: ["t3code", "--cwd", "/tmp/embedded-project", "--auto-bootstrap-project-from-cwd"],
        env: {
          T3CODE_DESKTOP_CWD: "/tmp/ignored-project",
          T3CODE_DESKTOP_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
        },
      }),
    ).toEqual({
      cwd: "/tmp/embedded-project",
      autoBootstrapProjectFromCwd: true,
    });
  });

  it("respects an explicit no-auto-bootstrap override", () => {
    expect(
      resolveDesktopBackendBootstrapConfig({
        argv: ["t3code", "--cwd=/tmp/focused-project", "--no-auto-bootstrap-project-from-cwd"],
        env: {},
      }),
    ).toEqual({
      cwd: "/tmp/focused-project",
      autoBootstrapProjectFromCwd: false,
    });
  });

  it("falls back to the generic server env names when desktop-specific ones are absent", () => {
    expect(
      resolveDesktopBackendBootstrapConfig({
        argv: ["t3code"],
        env: {
          T3CODE_CWD: "/tmp/shared-project",
          T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
        },
      }),
    ).toEqual({
      cwd: "/tmp/shared-project",
      autoBootstrapProjectFromCwd: false,
    });
  });
});
