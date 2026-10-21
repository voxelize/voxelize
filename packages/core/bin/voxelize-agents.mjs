#!/usr/bin/env node
//
// Points a project's coding agents at the Voxelize docs that ship with the
// installed @voxelize/core.
//
//   npx voxelize-agents init [--dir <project>]
//
// - Writes (or refreshes) the managed block between
//   <!-- BEGIN:voxelize-agent-rules --> and <!-- END:voxelize-agent-rules -->
//   in AGENTS.md, creating the file if needed. Text outside the block is
//   never touched.
// - Makes CLAUDE.md import AGENTS.md (`@AGENTS.md`) when it does not already.
// - Links each shipped skill into .claude/skills/ and .agents/skills/, so
//   agents that discover skills by folder find them; the links point into
//   node_modules, so they follow upgrades.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BEGIN = "<!-- BEGIN:voxelize-agent-rules -->";
const END = "<!-- END:voxelize-agent-rules -->";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  let dir = process.cwd();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--dir") dir = path.resolve(rest[++i] ?? ".");
  }
  return { command, dir };
}

function writeBlock(projectDir) {
  const block = readFileSync(
    path.join(packageRoot, "AGENTS.consumer.md"),
    "utf8",
  ).trim();
  const target = path.join(projectDir, "AGENTS.md");
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  let next;
  if (start !== -1 && end > start) {
    next = current.slice(0, start) + block + current.slice(end + END.length);
  } else {
    next = current.trim() ? `${current.trimEnd()}\n\n${block}\n` : `${block}\n`;
  }
  if (next !== current) writeFileSync(target, next);
  return target;
}

function ensureClaudeImport(projectDir) {
  const target = path.join(projectDir, "CLAUDE.md");
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (/^@AGENTS\.md\s*$/m.test(current)) return null;
  writeFileSync(
    target,
    current.trim() ? `@AGENTS.md\n\n${current}` : "@AGENTS.md\n",
  );
  return target;
}

function linkSkills(projectDir) {
  const skillsDir = path.join(packageRoot, "skills");
  if (!existsSync(skillsDir)) return [];
  const linked = [];
  for (const name of readdirSync(skillsDir)) {
    const source = path.join(skillsDir, name);
    if (!existsSync(path.join(source, "SKILL.md"))) continue;
    for (const home of [".claude/skills", ".agents/skills"]) {
      const targetDir = path.join(projectDir, home);
      const target = path.join(targetDir, name);
      mkdirSync(targetDir, { recursive: true });
      if (existsSync(target) || isDanglingLink(target)) continue;
      symlinkSync(path.relative(targetDir, source), target, "dir");
      linked.push(target);
    }
  }
  return linked;
}

function isDanglingLink(target) {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function main() {
  const { command, dir } = parseArgs(process.argv.slice(2));
  if (command !== "init") {
    process.stdout.write(
      "usage: voxelize-agents init [--dir <project>]\n" +
        "  Adds the Voxelize block to AGENTS.md, imports it from CLAUDE.md,\n" +
        "  and links the shipped skills into .claude/skills and .agents/skills.\n",
    );
    process.exit(command ? 1 : 0);
  }
  const agents = writeBlock(dir);
  const claude = ensureClaudeImport(dir);
  const skills = linkSkills(dir);
  process.stdout.write(
    `voxelize-agents: wrote ${path.relative(dir, agents)}\n`,
  );
  if (claude) {
    process.stdout.write(
      `voxelize-agents: ${path.relative(dir, claude)} now imports AGENTS.md\n`,
    );
  }
  for (const link of skills) {
    process.stdout.write(
      `voxelize-agents: linked ${path.relative(dir, link)}\n`,
    );
  }
}

main();
