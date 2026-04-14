import { describe, expect, it } from "vitest";

import { resolveDesktopUserDataPath } from "./userDataPath";

describe("resolveDesktopUserDataPath", () => {
  it("uses the sub-environment storage directory when T3CODE_HOME is custom", () => {
    expect(
      resolveDesktopUserDataPath({
        baseDir: "/tmp/t3code/subenv-nrle",
        homeDir: "/home/dannym",
        platform: "linux",
        env: {},
      }),
    ).toBe("/tmp/t3code/subenv-nrle/userdata");
  });

  it("keeps the legacy Chromium profile path for the default base dir when it exists", () => {
    expect(
      resolveDesktopUserDataPath({
        baseDir: "/home/dannym/.t3",
        homeDir: "/home/dannym",
        platform: "linux",
        env: {},
        pathExists: (path) => path === "/home/dannym/.config/T3 Code (Alpha)",
      }),
    ).toBe("/home/dannym/.config/T3 Code (Alpha)");
  });

  it("falls back to the lowercase Chromium profile path for the default base dir", () => {
    expect(
      resolveDesktopUserDataPath({
        baseDir: "/home/dannym/.t3",
        homeDir: "/home/dannym",
        platform: "linux",
        env: {},
        pathExists: () => false,
      }),
    ).toBe("/home/dannym/.config/t3code");
  });
});
