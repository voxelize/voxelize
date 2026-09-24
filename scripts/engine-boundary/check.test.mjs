import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  HASH_SCHEME,
  applyExcuses,
  buildDenylist,
  digestPhrase,
  formatReport,
  normalizePhrase,
  scanPath,
  scanText,
  tokenize,
} from "./check.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "engine-boundary-test-"));
mkdirSync(path.join(root, "packages", "core", "src"), { recursive: true });
mkdirSync(path.join(root, "server", "world"), { recursive: true });
after(() => rmSync(root, { recursive: true, force: true }));

const hashed = {
  hash: HASH_SCHEME,
  maxWords: 2,
  consumers: {
    acme: {
      paths: ["game/src/"],
      aliases: ["~acme/"],
      packages: ["acme-game"],
    },
  },
  groups: [
    {
      id: "acme/creature",
      consumer: "acme",
      kind: "creature",
      why: "a creature the consumer ships",
      digests: [digestPhrase("zorblax"), digestPhrase("quux widget")],
    },
  ],
};
const denylist = buildDenylist(hashed, null);

const scan = (relPath, text) => scanText({ relPath, text, denylist, root });

describe("tokens", () => {
  it("splits identifiers on case, digits stay attached", () => {
    assert.deepEqual(
      tokenize("HTMLParser hub2World dune_spitter").map((t) => t.word),
      ["html", "parser", "hub2", "world", "dune", "spitter"],
    );
  });

  it("normalizes every identifier style to one phrase", () => {
    for (const style of [
      "QuuxWidget",
      "quux_widget",
      "quux-widget",
      "Quux Widget",
    ]) {
      assert.equal(normalizePhrase(style), "quux widget");
    }
  });

  it("digests are stable 16-hex strings", () => {
    assert.match(digestPhrase("zorblax"), /^[0-9a-f]{16}$/);
    assert.equal(digestPhrase("zorblax"), digestPhrase("zorblax"));
    assert.notEqual(digestPhrase("zorblax"), digestPhrase("zorblay"));
  });
});

describe("term rule", () => {
  it("finds a hashed term in any identifier style, with its position", () => {
    const hits = scan(
      "packages/core/src/a.ts",
      "const x = new QuuxWidgetPool(); // zorblax",
    );
    assert.deepEqual(
      hits.map((h) => [h.term, h.column, h.text]),
      [
        ["quux widget", 15, "QuuxWidget"],
        ["zorblax", 36, "zorblax"],
      ],
    );
    assert.equal(hits[0].kind, "creature");
    assert.equal(hits[0].consumer, "acme");
  });

  it("does not match a term inside a longer word", () => {
    assert.deepEqual(
      scan("packages/core/src/a.ts", "zorblaxian quuxwidget"),
      [],
    );
  });

  it("checks file names too", () => {
    const hits = scanPath({ relPath: "assets/zorblax-portrait.png", denylist });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 0);
  });

  it("lets a plain-text vocabulary replace that consumer's digests", () => {
    const merged = buildDenylist(hashed, {
      groups: [
        {
          id: "acme/term",
          consumer: "acme",
          kind: "game-term",
          why: "a term",
          terms: ["Flibber Deck"],
        },
      ],
    });
    const text = "zorblax flibberDeck";
    const hits = scanText({
      relPath: "server/world/a.rs",
      text,
      denylist: merged,
      root,
    });
    assert.deepEqual(
      hits.map((h) => h.term),
      ["flibber deck"],
    );
  });

  it("refuses a denylist hashed under another scheme", () => {
    assert.throws(
      () => buildDenylist({ ...hashed, hash: "md5" }, null),
      /hash scheme/,
    );
  });
});

describe("path rules", () => {
  it("flags a relative path that escapes the engine root", () => {
    const hits = scan(
      "packages/core/src/a.ts",
      'import { x } from "../../../../game/src/x";\nimport { y } from "../lib/y";',
    );
    assert.deepEqual(
      hits.map((h) => [h.rule, h.line]),
      [["path-escape", 1]],
    );
  });

  it("flags root-relative consumer paths but not the engine's own lookalikes", () => {
    const hits = scan(
      "docs/a.md",
      "see game/src/foo.ts, not examples/game/src/foo.ts",
    );
    assert.deepEqual(
      hits.map((h) => [h.rule, h.text]),
      [["consumer-path", "game/src/foo.ts"]],
    );
  });

  it("flags consumer aliases and packages only in import position", () => {
    const hits = scan(
      "packages/core/src/a.ts",
      'import a from "~acme/util";\nimport b from "acme-game/core";\nconst s = "acme-game";',
    );
    assert.deepEqual(
      hits.map((h) => [h.rule, h.line]),
      [
        ["consumer-import", 1],
        ["consumer-import", 2],
      ],
    );
  });
});

describe("block-name-literal rule", () => {
  it("flags engine logic keyed on a block name, outside test modules", () => {
    const text = [
      'if neighbor.name == "Crate" { link(); }',
      "#[cfg(test)]",
      "mod tests {",
      '  const _: bool = block.name == "Crate";',
      "}",
    ].join("\n");
    const hits = scan("server/world/linking.rs", text);
    assert.deepEqual(
      hits.map((h) => [h.rule, h.line]),
      [["block-name-literal", 1]],
    );
  });

  it("leaves tests, examples and docs alone", () => {
    const line = 'if block.name == "Crate" {}';
    assert.deepEqual(scan("server/world/linking_tests.rs", line), []);
    assert.deepEqual(scan("examples/server/main.rs", line), []);
    assert.deepEqual(
      scan("packages/core/src/a.test.ts", 'getBlockByName("Crate")'),
      [],
    );
  });

  it("flags registry lookups by literal name in TypeScript engine code", () => {
    const hits = scan(
      "packages/core/src/a.ts",
      'const crate = world.getBlockByName("Crate");',
    );
    assert.equal(hits[0].rule, "block-name-literal");
  });
});

describe("excuses", () => {
  writeFileSync(path.join(root, "README.md"), "zorblax");
  const violations = [
    ...scanText({
      relPath: "README.md",
      text: "zorblax and QuuxWidget",
      denylist,
      root,
    }),
    ...scan("server/world/a.rs", 'x.name == "Crate"'),
  ];
  writeFileSync(path.join(root, "server", "world", "a.rs"), "");

  it("excuses by path and term, and by rule", () => {
    const { remaining, stale } = applyExcuses({
      root,
      violations,
      excuses: {
        excuses: [
          {
            path: "README.md",
            terms: ["zorblax", "Quux Widget"],
            reason: "showcase credits the consumer",
          },
          {
            path: "server/world/a.rs",
            rule: "block-name-literal",
            reason: "the engine's own built-in block",
          },
        ],
      },
    });
    assert.deepEqual(remaining, []);
    assert.deepEqual(stale, []);
  });

  it("fails an excuse that no longer matches, a term gone from it, and a vanished path", () => {
    const { stale } = applyExcuses({
      root,
      violations,
      excuses: {
        excuses: [
          {
            path: "README.md",
            terms: ["zorblax", "flibber"],
            reason: "showcase credits the consumer",
          },
          {
            path: "server/world/a.rs",
            reason: "nothing trips the term rule here",
          },
          { path: "gone.md", reason: "this file was deleted long ago" },
        ],
      },
    });
    assert.deepEqual(
      stale.map((s) => s.detail),
      [
        '"flibber" no longer appears in README.md',
        "nothing under server/world/a.rs trips the term rule any more",
        "gone.md no longer exists",
      ],
    );
  });

  it("insists on a reason", () => {
    assert.throws(
      () =>
        applyExcuses({
          root,
          violations,
          excuses: { excuses: [{ path: "README.md" }] },
        }),
      /reason/,
    );
  });
});

describe("report", () => {
  it("names the file, line, column, the text and why", () => {
    const [hit] = scan("packages/core/src/a.ts", "// zorblax");
    const report = formatReport({
      remaining: [hit],
      stale: [],
      fileCount: 1,
      elapsedMs: 1,
    });
    assert.match(report, /packages\/core\/src\/a\.ts:1:4 {2}"zorblax"/);
    assert.match(report, /creature of acme: a creature the consumer ships/);
  });
});
