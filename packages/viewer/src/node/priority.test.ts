import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  lowerSpawn,
  lowPriorityExecutable,
  lowPriorityPrefix,
} from "./priority";

const mac = { platform: "darwin" as const, exists: () => true };
const linux = { platform: "linux" as const, exists: () => false };
const windows = { platform: "win32" as const, exists: () => false };

describe("lowPriorityPrefix", () => {
  it("clamps QoS on macOS, nices on Linux, and has nothing elsewhere", () => {
    expect(lowPriorityPrefix(mac)).toEqual([
      "/usr/sbin/taskpolicy",
      "-c",
      "utility",
    ]);
    expect(lowPriorityPrefix(linux)).toEqual(["nice", "-n", "10"]);
    expect(lowPriorityPrefix(windows)).toBeNull();
  });

  it("does not clamp on a macOS without taskpolicy", () => {
    expect(
      lowPriorityPrefix({ platform: "darwin", exists: () => false }),
    ).toBeNull();
  });
});

describe("lowerSpawn", () => {
  const spec = {
    command: "/bin/backend",
    args: ["--flag", "a b"],
    env: { HOOK: "launch.json" },
    cwd: "/work",
  };

  it("runs the command through the prefix and keeps env and cwd", () => {
    expect(lowerSpawn(spec, mac)).toEqual({
      command: "/usr/sbin/taskpolicy",
      args: ["-c", "utility", "/bin/backend", "--flag", "a b"],
      env: { HOOK: "launch.json" },
      cwd: "/work",
    });
    expect(lowerSpawn({ command: "/bin/backend" }, linux)).toEqual({
      command: "nice",
      args: ["-n", "10", "/bin/backend"],
    });
  });

  it("leaves the spec alone where there is no lowering", () => {
    expect(lowerSpawn(spec, windows)).toBe(spec);
  });
});

describe("lowPriorityExecutable", () => {
  it("writes a script that execs the program lowered with its arguments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-priority-"));
    const program = path.join(dir, "it's a program");
    fs.writeFileSync(program, '#!/bin/sh\necho "$0|$*"\n', { mode: 0o755 });
    const file = lowPriorityExecutable(program, dir, linux);
    expect(file).not.toBeNull();
    expect(fs.readFileSync(file as string, "utf8")).toBe(
      `#!/bin/sh\nexec 'nice' '-n' '10' '${program.replace(/'/g, `'\\''`)}' "$@"\n`,
    );
    if (process.platform === "linux" || process.platform === "darwin") {
      expect(
        execFileSync(file as string, ["one", "two words"], {
          encoding: "utf8",
        }).trim(),
      ).toBe(`${program}|one two words`);
    }
    // Rewritten only when it changes; the same program keeps one script.
    expect(lowPriorityExecutable(program, dir, linux)).toBe(file);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".sh"))).toHaveLength(
      1,
    );
  });

  it("returns null where there is no lowering", () => {
    expect(lowPriorityExecutable("/bin/true", os.tmpdir(), windows)).toBeNull();
  });
});
