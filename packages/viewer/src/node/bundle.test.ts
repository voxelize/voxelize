import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { assetUrl, bundlePage, rebaseStylesheetUrls } from "./bundle";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-stylesheet-"));
const src = path.join(root, "src");
const pub = path.join(root, "public");
const styles = path.join(src, "app", "styles");
for (const file of [
  path.join(src, "assets", "fonts", "Serif Face.otf"),
  path.join(styles, "grain.png"),
  path.join(pub, "frame.png"),
]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("a stylesheet served away from its source file", () => {
  it("points its relative urls at the asset files they name", () => {
    const css = [
      `@font-face{src:url("../../assets/fonts/Serif%20Face.otf?v=2#face")}`,
      `.a{background:url(grain.png)}`,
      `.b{background:url('./grain.png')}`,
    ].join("\n");
    const { css: rebased, outside } = rebaseStylesheetUrls(css, styles, [
      src,
      pub,
    ]);
    expect(outside).toEqual([]);
    expect(rebased).toContain(
      `url("${assetUrl(path.join(src, "assets", "fonts", "Serif Face.otf"), [src, pub], "/asset")}?v=2#face")`,
    );
    expect(rebased).toContain(`url(/asset/0/app/styles/grain.png)`);
    expect(rebased).toContain(`url('/asset/0/app/styles/grain.png')`);
  });

  it("leaves absolute, root-relative, data and fragment urls alone", () => {
    const css = [
      `.a{background:url("/frame.png")}`,
      `.b{background:url(https://example.com/x.png)}`,
      `.c{background:url(data:image/png;base64,AAAA)}`,
      `.d{filter:url(#glow)}`,
      `.e{background:url(//cdn.example.com/y.png)}`,
    ].join("\n");
    expect(rebaseStylesheetUrls(css, styles, [src, pub])).toEqual({
      css,
      outside: [],
    });
  });

  it("bundles compact for a page served over a network: minified, no source map", async () => {
    const entry = path.join(root, "entry.ts");
    fs.writeFileSync(
      entry,
      "export const longDescriptiveName = (value: number) => value * 2;\nconsole.log(longDescriptiveName(21));\n",
    );
    const sizes: Record<string, number> = {};
    for (const compact of [false, true]) {
      const outDir = path.join(root, compact ? "compact" : "full");
      const { app } = await bundlePage({
        entry,
        outDir,
        assetRoots: [src],
        minify: compact,
        sourcemap: !compact,
      });
      const text = fs.readFileSync(app, "utf8");
      expect(text.includes("sourceMappingURL"), String(compact)).toBe(!compact);
      sizes[compact ? "compact" : "full"] = text.length;
    }
    expect(sizes.compact).toBeLessThan(sizes.full / 2);
  });

  it("names the relative urls nothing serves instead of guessing", () => {
    const css = `.a{background:url(../missing.png)}.b{background:url(../../../../outside.png)}`;
    const { css: rebased, outside } = rebaseStylesheetUrls(css, styles, [
      src,
      pub,
    ]);
    expect(rebased).toBe(css);
    expect(outside).toEqual(["../missing.png", "../../../../outside.png"]);
  });
});
