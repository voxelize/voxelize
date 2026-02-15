import { describe, expect, it } from "vitest";

import {
  resolveCommand,
  resolveCommandForPlatform,
  resolvePnpmCommand,
  resolvePnpmCommandForPlatform,
} from "../scripts/command-utils.mjs";

describe("command-utils", () => {
  it("resolves pnpm and binaries for windows platform", () => {
    expect(resolveCommandForPlatform("pnpm", "win32")).toBe("pnpm.cmd");
    expect(resolveCommandForPlatform("cargo", "win32")).toBe("cargo.exe");
    expect(resolveCommandForPlatform("wasm-pack", "win32")).toBe(
      "wasm-pack.exe"
    );
  });

  it("preserves command names for non-windows platforms", () => {
    expect(resolveCommandForPlatform("pnpm", "linux")).toBe("pnpm");
    expect(resolveCommandForPlatform("cargo", "darwin")).toBe("cargo");
  });

  it("provides pnpm helper for explicit platform", () => {
    expect(resolvePnpmCommandForPlatform("win32")).toBe("pnpm.cmd");
    expect(resolvePnpmCommandForPlatform("linux")).toBe("pnpm");
  });

  it("matches platform-aware helpers on current platform", () => {
    expect(resolvePnpmCommand()).toBe(
      resolvePnpmCommandForPlatform(process.platform)
    );
    expect(resolveCommand("pnpm")).toBe(
      resolveCommandForPlatform("pnpm", process.platform)
    );
  });
});
