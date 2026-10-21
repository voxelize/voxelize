import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import * as THREE from "three";
import { describe, it } from "vitest";

import * as VOXELIZE from "./index";

/// The consumer skills ship in the npm package and are what an agent in a
/// game reads instead of this repository. A skill whose sources moved, or
/// that names an export the package no longer has, teaches the wrong API
/// with full confidence; this keeps them honest.

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");

/// Names a skill may use that are not TypeScript exports: the server's Rust
/// types (and the example's), which the crate's own docs cover.
const NON_TS_NAMES = new Set([
  "PositionComp",
  "DirectionComp",
  "VariantComp",
  "VariantMetadataSystem",
  "EntitiesMetaSystem",
]);

/// Whether `name` is an exported interface, type or class in the package
/// source (types erase at runtime, so `in VOXELIZE` cannot see them).
function isDeclaredType(
  name: string,
  dir = path.join(PACKAGE_ROOT, "src"),
): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isDeclaredType(name, full)) return true;
    } else if (/\.tsx?$/.test(entry.name)) {
      const text = readFileSync(full, "utf8");
      if (new RegExp(`export (interface|type|class) ${name}\\b`).test(text)) {
        return true;
      }
    }
  }
  return false;
}

function readSkills(): { name: string; text: string }[] {
  return readdirSync(SKILLS_DIR)
    .filter((name) => existsSync(path.join(SKILLS_DIR, name, "SKILL.md")))
    .map((name) => ({
      name,
      text: readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8"),
    }));
}

function frontmatter(text: string): string {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "a skill starts with --- frontmatter ---");
  return match[1];
}

describe("shipped agent skills", () => {
  const skills = readSkills();

  it("ships at least one skill", () => {
    assert.ok(skills.length > 0);
  });

  for (const skill of skills) {
    describe(skill.name, () => {
      const meta = frontmatter(skill.text);

      it("names itself after its folder and says when to use it", () => {
        assert.match(meta, new RegExp(`^name: ${skill.name}$`, "m"));
        const description = meta.match(/^description: (.+)$/m)?.[1] ?? "";
        assert.ok(
          description.length > 80 && /\bUse when\b/.test(description),
          "the description names the tasks that should load it ('Use when ...')",
        );
      });

      it("lists sources that still exist", () => {
        const sources = [...meta.matchAll(/^ {2}- (.+)$/gm)].map((m) => m[1]);
        assert.ok(sources.length > 0, "sources: lists the files it teaches");
        for (const source of sources) {
          assert.ok(
            existsSync(path.join(REPO_ROOT, source)),
            `${skill.name} names ${source}, which no longer exists`,
          );
        }
      });

      it("names only APIs the package exports", () => {
        const named = [...skill.text.matchAll(/VOXELIZE\.(\w+)/g)].map(
          (m) => m[1],
        );
        const backticked = [...skill.text.matchAll(/`([A-Z]\w+)`/g)]
          .map((m) => m[1])
          .filter((name) => /^[A-Z][a-z]/.test(name));
        for (const name of new Set([...named, ...backticked])) {
          const isKnown =
            name in VOXELIZE ||
            name in THREE ||
            NON_TS_NAMES.has(name) ||
            isDeclaredType(name);
          assert.ok(
            isKnown,
            `${skill.name} names ${name}, which @voxelize/core does not export`,
          );
        }
      });
    });
  }
});
