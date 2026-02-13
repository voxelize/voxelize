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
    expect(manifest.scripts["check:client:verify:json:compact"]).toBe(
      "node ./check-client.mjs --json --no-build --compact"
    );
    expect(manifest.scripts["check:onboarding:json:compact"]).toBe(
      "node ./check-onboarding.mjs --json --compact"
    );
    expect(manifest.scripts["check:onboarding:verify:json:compact"]).toBe(
      "node ./check-onboarding.mjs --json --no-build --compact"
    );
    expect(manifest.scripts["check:preflight:json:compact"]).toBe(
      "node ./check-preflight.mjs --compact"
    );
    expect(manifest.scripts["check:preflight:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --no-build --compact"
    );
    expect(manifest.scripts["check:preflight:list:json"]).toBe(
      "node ./check-preflight.mjs --list-checks"
    );
    expect(manifest.scripts["check:preflight:list:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --no-build"
    );
    expect(manifest.scripts["check:preflight:list:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --compact"
    );
    expect(manifest.scripts["check:preflight:list:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --no-build --compact"
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
      "node ./check-preflight.mjs --list-checks --no-build --only all"
    );
    expect(manifest.scripts["check:preflight:list:all:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only all --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:all:verify:json:compact"]
    ).toBe("node ./check-preflight.mjs --list-checks --no-build --only all --compact");
    expect(manifest.scripts["check:preflight:list:all-checks:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --only all-checks"
    );
    expect(manifest.scripts["check:preflight:list:all-checks:verify:json"]).toBe(
      "node ./check-preflight.mjs --list-checks --no-build --only all-checks"
    );
    expect(manifest.scripts["check:preflight:list:all-checks:json:compact"]).toBe(
      "node ./check-preflight.mjs --list-checks --only all-checks --compact"
    );
    expect(
      manifest.scripts["check:preflight:list:all-checks:verify:json:compact"]
    ).toBe(
      "node ./check-preflight.mjs --list-checks --no-build --only all-checks --compact"
    );
    expect(manifest.scripts["check:preflight:all:json"]).toBe(
      "node ./check-preflight.mjs --only all"
    );
    expect(manifest.scripts["check:preflight:all:verify:json"]).toBe(
      "node ./check-preflight.mjs --no-build --only all"
    );
    expect(manifest.scripts["check:preflight:all:json:compact"]).toBe(
      "node ./check-preflight.mjs --only all --compact"
    );
    expect(manifest.scripts["check:preflight:all:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --no-build --only all --compact"
    );
    expect(manifest.scripts["check:preflight:all-checks:json"]).toBe(
      "node ./check-preflight.mjs --only all-checks"
    );
    expect(manifest.scripts["check:preflight:all-checks:verify:json"]).toBe(
      "node ./check-preflight.mjs --no-build --only all-checks"
    );
    expect(manifest.scripts["check:preflight:all-checks:json:compact"]).toBe(
      "node ./check-preflight.mjs --only all-checks --compact"
    );
    expect(
      manifest.scripts["check:preflight:all-checks:verify:json:compact"]
    ).toBe("node ./check-preflight.mjs --no-build --only all-checks --compact");
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
    expect(manifest.scripts["check:preflight:client:json:compact"]).toBe(
      "node ./check-preflight.mjs --only client --compact"
    );
    expect(manifest.scripts["check:preflight:client:verify:json:compact"]).toBe(
      "node ./check-preflight.mjs --no-build --only client --compact"
    );
  });

  it("defines compact json aliases for client wasm preflight scripts", () => {
    const manifest = readPackageManifest(clientManifestPath);

    expect(manifest.scripts["check:wasm:json:compact"]).toBe(
      "node ./scripts/check-wasm-mesher.mjs --json --compact"
    );
    expect(manifest.scripts["check:wasm:verify:json:compact"]).toBe(
      "node ./scripts/check-wasm-mesher.mjs --json --no-build --compact"
    );
  });
});
