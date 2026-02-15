import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  scripts: Record<string, string>;
};

const readPackageManifest = (manifestPath: string): PackageManifest => {
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as PackageManifest;
};

const rootDir = path.resolve(__dirname, "..");
const rootManifestPath = path.resolve(rootDir, "package.json");
const clientManifestPath = path.resolve(rootDir, "examples", "client", "package.json");
const tsCoreManifestPath = path.resolve(
  rootDir,
  "packages",
  "ts-core",
  "package.json"
);

describe("script aliases", () => {
  it("defines compact json aliases for root preflight scripts", () => {
    const manifest = readPackageManifest(rootManifestPath);

    expect(manifest.scripts["check:dev-env:json:compact"]).toBe(
      "node ./check-dev-env.mjs --json --compact"
    );
    expect(manifest.scripts["check:wasm-pack:json:compact"]).toBe(
      "node ./check-wasm-pack.mjs --json --compact"
    );
    expect(manifest.scripts["check:client:json:compact"]).toBe(
      "node ./check-client.mjs --json --compact"
    );
    expect(manifest.scripts["check:client:verify"]).toBe(
      "node ./check-client.mjs --verify"
    );
    expect(manifest.scripts["check:client:verify:json"]).toBe(
      "node ./check-client.mjs --json --verify"
    );
    expect(manifest.scripts["check:client:verify:json:compact"]).toBe(
      "node ./check-client.mjs --json --verify --compact"
    );
    expect(manifest.scripts["check:onboarding:json:compact"]).toBe(
      "node ./check-onboarding.mjs --json --compact"
    );
    expect(manifest.scripts["check:onboarding:verify"]).toBe(
      "node ./check-onboarding.mjs --verify"
    );
    expect(manifest.scripts["check:onboarding:verify:json"]).toBe(
      "node ./check-onboarding.mjs --json --verify"
    );
    expect(manifest.scripts["check:onboarding:verify:json:compact"]).toBe(
      "node ./check-onboarding.mjs --json --verify --compact"
    );
    expect(manifest.scripts["check:runtime-libraries"]).toBe(
      "node ./check-runtime-libraries.mjs"
    );
    expect(manifest.scripts["check:runtime-libraries:json"]).toBe(
      "node ./check-runtime-libraries.mjs --json"
    );
    expect(manifest.scripts["check:runtime-libraries:json:compact"]).toBe(
      "node ./check-runtime-libraries.mjs --json --compact"
    );
    expect(manifest.scripts["check:runtime-libraries:verify"]).toBe(
      "node ./check-runtime-libraries.mjs --verify"
    );
    expect(manifest.scripts["check:runtime-libraries:verify:json"]).toBe(
      "node ./check-runtime-libraries.mjs --json --verify"
    );
    expect(manifest.scripts["check:runtime-libraries:verify:json:compact"]).toBe(
      "node ./check-runtime-libraries.mjs --json --verify --compact"
    );
    expect(manifest.scripts["check:runtime-libraries:release"]).toBe(
      "pnpm --filter @voxelize/aabb run build && pnpm --filter @voxelize/raycast run build && pnpm --filter @voxelize/physics-engine run build && pnpm run check:runtime-libraries:verify:json"
    );
    expect(manifest.scripts["check:runtime:release"]).toBe(
      "pnpm run check:runtime-libraries:release"
    );
    expect(manifest.scripts["check:preflight:runtime-libraries:release"]).toBe(
      "pnpm run check:runtime-libraries:release && pnpm run check:preflight:runtime-libraries:verify:json"
    );
    expect(manifest.scripts["check:preflight:runtime:release"]).toBe(
      "pnpm run check:preflight:runtime-libraries:release"
    );
    expect(manifest.scripts["check:ts-core"]).toBe("node ./check-ts-core.mjs");
    expect(manifest.scripts["check:ts-core:json"]).toBe(
      "node ./check-ts-core.mjs --json"
    );
    expect(manifest.scripts["check:ts-core:json:compact"]).toBe(
      "node ./check-ts-core.mjs --json --compact"
    );
    expect(manifest.scripts["check:ts-core:verify"]).toBe(
      "node ./check-ts-core.mjs --verify"
    );
    expect(manifest.scripts["check:ts-core:verify:json"]).toBe(
      "node ./check-ts-core.mjs --json --verify"
    );
    expect(manifest.scripts["check:ts-core:verify:json:compact"]).toBe(
      "node ./check-ts-core.mjs --json --verify --compact"
    );
    expect(manifest.scripts["check:ts-core:release"]).toBe(
      "pnpm --filter @voxelize/ts-core run build && pnpm --filter @voxelize/ts-core run test && pnpm --filter @voxelize/ts-core run example:end-to-end:no-build && pnpm run check:ts-core:verify:json"
    );
    expect(manifest.scripts["check:ts:release"]).toBe(
      "pnpm run check:ts-core:release"
    );
    expect(manifest.scripts["check:typescript:release"]).toBe(
      "pnpm run check:ts-core:release"
    );
    expect(manifest.scripts["check:preflight:ts-core:release"]).toBe(
      "pnpm run check:ts-core:release && pnpm run check:preflight:ts-core:verify:json"
    );
    expect(manifest.scripts["check:preflight:ts:release"]).toBe(
      "pnpm run check:preflight:ts-core:release"
    );
    expect(manifest.scripts["check:preflight:typescript:release"]).toBe(
      "pnpm run check:preflight:ts-core:release"
    );
    expect(manifest.scripts["check:libraries:release"]).toBe(
      "pnpm run check:ts-core:release && pnpm run check:runtime-libraries:release"
    );
    expect(manifest.scripts["check:library:release"]).toBe(
      "pnpm run check:libraries:release"
    );
    expect(manifest.scripts["check:libs:release"]).toBe(
      "pnpm run check:libraries:release"
    );
    expect(manifest.scripts["check:lib:release"]).toBe(
      "pnpm run check:libraries:release"
    );
    expect(manifest.scripts["check:preflight:libraries:release"]).toBe(
      "pnpm run check:libraries:release && pnpm run check:preflight:libraries:verify:json"
    );
    expect(manifest.scripts["check:preflight:library:release"]).toBe(
      "pnpm run check:preflight:libraries:release"
    );
    expect(manifest.scripts["check:preflight:libs:release"]).toBe(
      "pnpm run check:preflight:libraries:release"
    );
    expect(manifest.scripts["check:preflight:lib:release"]).toBe(
      "pnpm run check:preflight:libraries:release"
    );
    expect(manifest.scripts["check:preflight:json:compact"]).toBe(
      "node ./check-preflight.mjs --compact"
    );
    expect(manifest.scripts["check:preflight:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify"
    );
    expect(manifest.scripts["check:preflight:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --compact"
    );
    expect(manifest.scripts["check:preflight:list:json"]).toBe(
      "node ./check-preflight.mjs --list-checks"
    );
    expect(manifest.scripts["check:preflight:list:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify"
    );
    expect(manifest.scripts["check:preflight:list:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --compact"
    );
    expect(manifest.scripts["check:preflight:list:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --compact"
    );
    expect(manifest.scripts["check:preflight:list:dev:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only devEnvironment"
    );
    expect(manifest.scripts["check:preflight:list:dev:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only devEnvironment --compact"
    );
    expect(manifest.scripts["check:preflight:list:wasm:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only wasmPack"
    );
    expect(manifest.scripts["check:preflight:list:wasm:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only wasmPack --compact"
    );
    expect(manifest.scripts["check:preflight:list:ts-core:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only tsCore"
    );
    expect(manifest.scripts["check:preflight:list:ts-core:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only tsCore"
    );
    expect(manifest.scripts["check:preflight:list:ts-core:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only tsCore --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:ts-core:verify:json:compact"]
    ).toBe("node ./check-preflight.mjs --list-checks --verify --only tsCore --compact");
    expect(manifest.scripts["check:preflight:list:runtime-libraries:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only runtimeLibraries"
    );
    expect(
      manifest.scripts["check:preflight:list:runtime-libraries:verify:json"]
    ).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only runtimeLibraries"
    );
    expect(
      manifest.scripts["check:preflight:list:runtime-libraries:json:compact"]
    ).toBe(
      "node ./check-preflight.mjs --list-checks --only runtimeLibraries --compact"
    );
    expect(
      manifest.scripts[
        "check:preflight:list:runtime-libraries:verify:json:compact"
      ]
    ).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only runtimeLibraries --compact"
    );
    expect(manifest.scripts["check:preflight:list:runtime:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only runtimeLibraries"
    );
    expect(manifest.scripts["check:preflight:list:runtime:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only runtimeLibraries"
    );
    expect(manifest.scripts["check:preflight:list:runtime:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only runtimeLibraries --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:runtime:verify:json:compact"]
    ).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only runtimeLibraries --compact"
    );
    expect(manifest.scripts["check:preflight:list:libraries:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only libraries"
    );
    expect(manifest.scripts["check:preflight:list:libraries:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only libraries"
    );
    expect(manifest.scripts["check:preflight:list:libraries:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only libraries --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:libraries:verify:json:compact"]
    ).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:list:library:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only libraries"
    );
    expect(manifest.scripts["check:preflight:list:library:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only libraries"
    );
    expect(manifest.scripts["check:preflight:list:library:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only libraries --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:library:verify:json:compact"]
    ).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:list:libs:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only libraries"
    );
    expect(manifest.scripts["check:preflight:list:libs:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only libraries"
    );
    expect(manifest.scripts["check:preflight:list:libs:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:list:libs:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:list:lib:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only libraries"
    );
    expect(manifest.scripts["check:preflight:list:lib:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only libraries"
    );
    expect(manifest.scripts["check:preflight:list:lib:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:list:lib:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:list:ts:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only tsCore"
    );
    expect(manifest.scripts["check:preflight:list:ts:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only tsCore"
    );
    expect(manifest.scripts["check:preflight:list:ts:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only tsCore --compact"
    );
    expect(manifest.scripts["check:preflight:list:ts:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only tsCore --compact"
    );
    expect(manifest.scripts["check:preflight:list:typescript:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only tsCore"
    );
    expect(manifest.scripts["check:preflight:list:typescript:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only tsCore"
    );
    expect(manifest.scripts["check:preflight:list:typescript:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only tsCore --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:typescript:verify:json:compact"]
    ).toBe("node ./check-preflight.mjs --list-checks --verify --only tsCore --compact");
    expect(manifest.scripts["check:preflight:list:client:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only client"
    );
    expect(manifest.scripts["check:preflight:list:client:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only client --compact"
    );
    expect(manifest.scripts["check:preflight:list:all:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only all"
    );
    expect(manifest.scripts["check:preflight:list:all:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only all"
    );
    expect(manifest.scripts["check:preflight:list:all:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only all --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:all:verify:json:compact"]
    ).toBe("node ./check-preflight.mjs --list-checks --verify --only all --compact");
    expect(manifest.scripts["check:preflight:list:all-checks:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only all-checks"
    );
    expect(manifest.scripts["check:preflight:list:all-checks:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only all-checks"
    );
    expect(manifest.scripts["check:preflight:list:all-checks:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only all-checks --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:all-checks:verify:json:compact"]
    ).toBe(
      "node ./check-preflight.mjs --list-checks --verify --only all-checks --compact"
    );
    expect(manifest.scripts["check:preflight:all:json"]).toBe(
      "node ./check-preflight.mjs --only all"
    );
    expect(manifest.scripts["check:preflight:all:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only all"
    );
    expect(manifest.scripts["check:preflight:all:json:compact"]).toBe(
      "node ./check-preflight.mjs --only all --compact"
    );
    expect(manifest.scripts["check:preflight:all:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only all --compact"
    );
    expect(manifest.scripts["check:preflight:all-checks:json"]).toBe(
      "node ./check-preflight.mjs --only all-checks"
    );
    expect(manifest.scripts["check:preflight:all-checks:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only all-checks"
    );
    expect(manifest.scripts["check:preflight:all-checks:json:compact"]).toBe(
      "node ./check-preflight.mjs --only all-checks --compact"
    );
    expect(
      manifest.scripts["check:preflight:all-checks:verify:json:compact"]
    ).toBe("node ./check-preflight.mjs --verify --only all-checks --compact");
    expect(manifest.scripts["check:preflight:dev-env:json:compact"]).toBe(
      "node ./check-preflight.mjs --only devEnvironment --compact"
    );
    expect(manifest.scripts["check:preflight:dev:json"]).toBe(
      "node ./check-preflight.mjs --only devEnvironment"
    );
    expect(manifest.scripts["check:preflight:dev:json:compact"]).toBe(
      "node ./check-preflight.mjs --only devEnvironment --compact"
    );
    expect(manifest.scripts["check:preflight:wasm-pack:json:compact"]).toBe(
      "node ./check-preflight.mjs --only wasmPack --compact"
    );
    expect(manifest.scripts["check:preflight:wasm:json"]).toBe(
      "node ./check-preflight.mjs --only wasmPack"
    );
    expect(manifest.scripts["check:preflight:wasm:json:compact"]).toBe(
      "node ./check-preflight.mjs --only wasmPack --compact"
    );
    expect(manifest.scripts["check:preflight:ts-core:json"]).toBe(
      "node ./check-preflight.mjs --only tsCore"
    );
    expect(manifest.scripts["check:preflight:ts-core:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only tsCore"
    );
    expect(manifest.scripts["check:preflight:ts-core:json:compact"]).toBe(
      "node ./check-preflight.mjs --only tsCore --compact"
    );
    expect(manifest.scripts["check:preflight:ts-core:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only tsCore --compact"
    );
    expect(manifest.scripts["check:preflight:runtime-libraries:json"]).toBe(
      "node ./check-preflight.mjs --only runtimeLibraries"
    );
    expect(manifest.scripts["check:preflight:runtime-libraries:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only runtimeLibraries"
    );
    expect(
      manifest.scripts["check:preflight:runtime-libraries:json:compact"]
    ).toBe("node ./check-preflight.mjs --only runtimeLibraries --compact");
    expect(
      manifest.scripts["check:preflight:runtime-libraries:verify:json:compact"]
    ).toBe(
      "node ./check-preflight.mjs --verify --only runtimeLibraries --compact"
    );
    expect(manifest.scripts["check:preflight:runtime:json"]).toBe(
      "node ./check-preflight.mjs --only runtimeLibraries"
    );
    expect(manifest.scripts["check:preflight:runtime:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only runtimeLibraries"
    );
    expect(manifest.scripts["check:preflight:runtime:json:compact"]).toBe(
      "node ./check-preflight.mjs --only runtimeLibraries --compact"
    );
    expect(manifest.scripts["check:preflight:runtime:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only runtimeLibraries --compact"
    );
    expect(manifest.scripts["check:preflight:libraries:json"]).toBe(
      "node ./check-preflight.mjs --only libraries"
    );
    expect(manifest.scripts["check:preflight:libraries:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only libraries"
    );
    expect(manifest.scripts["check:preflight:libraries:json:compact"]).toBe(
      "node ./check-preflight.mjs --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:libraries:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:library:json"]).toBe(
      "node ./check-preflight.mjs --only libraries"
    );
    expect(manifest.scripts["check:preflight:library:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only libraries"
    );
    expect(manifest.scripts["check:preflight:library:json:compact"]).toBe(
      "node ./check-preflight.mjs --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:library:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:libs:json"]).toBe(
      "node ./check-preflight.mjs --only libraries"
    );
    expect(manifest.scripts["check:preflight:libs:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only libraries"
    );
    expect(manifest.scripts["check:preflight:libs:json:compact"]).toBe(
      "node ./check-preflight.mjs --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:libs:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:lib:json"]).toBe(
      "node ./check-preflight.mjs --only libraries"
    );
    expect(manifest.scripts["check:preflight:lib:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only libraries"
    );
    expect(manifest.scripts["check:preflight:lib:json:compact"]).toBe(
      "node ./check-preflight.mjs --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:lib:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only libraries --compact"
    );
    expect(manifest.scripts["check:preflight:ts:json"]).toBe(
      "node ./check-preflight.mjs --only tsCore"
    );
    expect(manifest.scripts["check:preflight:ts:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only tsCore"
    );
    expect(manifest.scripts["check:preflight:ts:json:compact"]).toBe(
      "node ./check-preflight.mjs --only tsCore --compact"
    );
    expect(manifest.scripts["check:preflight:ts:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only tsCore --compact"
    );
    expect(manifest.scripts["check:preflight:typescript:json"]).toBe(
      "node ./check-preflight.mjs --only tsCore"
    );
    expect(manifest.scripts["check:preflight:typescript:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only tsCore"
    );
    expect(manifest.scripts["check:preflight:typescript:json:compact"]).toBe(
      "node ./check-preflight.mjs --only tsCore --compact"
    );
    expect(manifest.scripts["check:preflight:typescript:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only tsCore --compact"
    );
    expect(manifest.scripts["check:preflight:client:json:compact"]).toBe(
      "node ./check-preflight.mjs --only client --compact"
    );
    expect(manifest.scripts["check:preflight:client:verify:json"]).toBe(
      "node ./check-preflight.mjs --verify --only client"
    );
    expect(manifest.scripts["check:preflight:client:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --verify --only client --compact"
    );
  });

  it("defines compact json aliases for client wasm preflight scripts", () => {
    const manifest = readPackageManifest(clientManifestPath);

    expect(manifest.scripts["check:wasm:json:compact"]).toBe(
      "node ./scripts/check-wasm-mesher.mjs --json --compact"
    );
    expect(manifest.scripts["check:wasm:verify"]).toBe(
      "node ./scripts/check-wasm-mesher.mjs --verify"
    );
    expect(manifest.scripts["check:wasm:verify:json"]).toBe(
      "node ./scripts/check-wasm-mesher.mjs --json --verify"
    );
    expect(manifest.scripts["check:wasm:verify:json:compact"]).toBe(
      "node ./scripts/check-wasm-mesher.mjs --json --verify --compact"
    );
  });

  it("defines dedicated no-build ts-core example script aliases", () => {
    const manifest = readPackageManifest(tsCoreManifestPath);

    expect(manifest.scripts["example:end-to-end:no-build"]).toBe(
      "node ./examples/end-to-end.mjs"
    );
    expect(manifest.scripts["example:end-to-end"]).toBe(
      "pnpm run build && node ./examples/end-to-end.mjs"
    );
  });
});
