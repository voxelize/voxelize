/**
 * Builds the viewer page and its mesh worker with esbuild, from the host's
 * entry and the engine's sources. Asset imports get the shape bundlers
 * hand them out in (`{ src, width, height }` for an image, a URL for a
 * sound, the text for `?raw`), served back by the viewer server, so a
 * game's own registry and texture code bundles unchanged.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Esbuild = typeof import("esbuild");

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function loadEsbuild(): Promise<Esbuild> {
  try {
    return await import("esbuild");
  } catch {
    // Workspaces that have not linked this package's own esbuild yet still
    // carry the one tsx runs on.
    const require = createRequire(
      createRequire(import.meta.url).resolve("tsx/package.json"),
    );
    return require("esbuild") as Esbuild;
  }
}

export type PageBundleOptions = {
  /** The host's page entry (it creates the viewer and installs the control). */
  entry: string;
  outDir: string;
  /** Module aliases, e.g. a single `three` and `@voxelize/core` -> its source. */
  alias?: Record<string, string>;
  define?: Record<string, string>;
  /** URL prefix the server serves `assetRoots` files under. */
  assetPrefix?: string;
  /** Directories asset imports may come from (the server serves only these). */
  assetRoots: string[];
  /** `react`: an `.svg` import is a component rendering it (as SVGR makes one); `url` (default) is an image. */
  svg?: "url" | "react";
  /** `static` (default): an image import is `{ src, width, height }`, as Next.js hands it out; `url`: the URL alone, as Vite does. */
  images?: "static" | "url";
  minify?: boolean;
};

const camel = (name: string) =>
  name.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());

/** An SVG file as a React component module: root attributes as props, children as markup. */
function svgComponent(file: string): string {
  const text = fs.readFileSync(file, "utf8");
  const open = text.match(/<svg\b([^>]*)>/i);
  const close = text.lastIndexOf("</svg>");
  if (!open || close < 0) throw new Error(`${file} is not an SVG document`);
  const attributes: Record<string, string> = {};
  for (const [, name, value] of open[1].matchAll(
    /([\w:-]+)\s*=\s*"([^"]*)"/g,
  )) {
    if (name === "class") attributes.className = value;
    else if (name.startsWith("xmlns:")) continue;
    else attributes[name === "viewBox" ? name : camel(name)] = value;
  }
  const inner = text.slice(text.indexOf(open[0]) + open[0].length, close);
  return `import { createElement, forwardRef } from "react";
const attributes = ${JSON.stringify(attributes)};
const markup = ${JSON.stringify(inner)};
export default forwardRef(function Svg(props, ref) {
  return createElement("svg", { ...attributes, ...props, ref, dangerouslySetInnerHTML: { __html: markup } });
});`;
}

export type PageBundle = {
  app: string;
  worker: string;
  ms: number;
  assets: number;
};

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const SOUND = /\.(wav|ogg|mp3)$/i;

function imageSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file);
  if (bytes.length >= 24 && bytes.readUInt32BE(12) === 0x49484452) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

export function assetUrl(
  file: string,
  roots: string[],
  prefix: string,
): string {
  const absolute = path.resolve(file);
  const index = roots.findIndex((root) =>
    absolute.startsWith(path.resolve(root) + path.sep),
  );
  if (index < 0) throw new Error(`asset outside the served roots: ${absolute}`);
  const relative = path
    .relative(roots[index], absolute)
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/");
  return `${prefix}/${index}/${relative}`;
}

/**
 * A stylesheet built from a source file elsewhere (a Tailwind input, say)
 * keeps that file's relative `url()`s, which the browser resolves against
 * wherever the build is served instead. Points each at the asset URL of the
 * file it names from `base`, the source file's directory; absolute,
 * root-relative, `data:` and fragment URLs stay as they are. `outside`
 * lists the relative ones naming no file under `roots`, which no route
 * serves.
 */
export function rebaseStylesheetUrls(
  css: string,
  base: string,
  roots: string[],
  prefix = "/asset",
): { css: string; outside: string[] } {
  const outside: string[] = [];
  const rebased = css.replace(
    /url\(\s*(["']?)([^"')]*)\1\s*\)/g,
    (match, quote: string, url: string) => {
      if (url === "" || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return match;
      const cut = url.search(/[?#]/);
      const file = cut < 0 ? url : url.slice(0, cut);
      const query = cut < 0 ? "" : url.slice(cut);
      const absolute = path.resolve(base, decodeURI(file));
      if (!fs.existsSync(absolute)) {
        outside.push(url);
        return match;
      }
      try {
        return `url(${quote}${assetUrl(absolute, roots, prefix)}${query}${quote})`;
      } catch {
        outside.push(url);
        return match;
      }
    },
  );
  return { css: rebased, outside };
}

export async function bundlePage(
  options: PageBundleOptions,
): Promise<PageBundle> {
  const esbuild = await loadEsbuild();
  const started = Date.now();
  const prefix = options.assetPrefix ?? "/asset";
  let assets = 0;
  const assetsPlugin = {
    name: "viewer-assets",
    setup(build: import("esbuild").PluginBuild) {
      build.onResolve(
        { filter: /\?(raw|worker|worker&inline|url)$/ },
        (args) => {
          const [request, query] = args.path.split("?");
          return {
            path: path.resolve(args.resolveDir, request),
            namespace: query === "raw" ? "viewer-raw" : "viewer-worker-stub",
          };
        },
      );
      build.onLoad({ filter: /.*/, namespace: "viewer-raw" }, (args) => ({
        contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
        loader: "js",
      }));
      build.onLoad({ filter: /.*/, namespace: "viewer-worker-stub" }, () => ({
        // The viewer never starts the game's workers; a stand-in keeps a
        // module that constructs one at import from failing.
        contents:
          "export default class { constructor() { this.onmessage = null; } postMessage() {} terminate() {} addEventListener() {} removeEventListener() {} }",
        loader: "js",
      }));
      build.onLoad({ filter: /\.svg$/i }, (args) => {
        if (options.svg !== "react") return undefined;
        return {
          contents: svgComponent(args.path),
          loader: "js",
          resolveDir: path.dirname(args.path),
        };
      });
      build.onLoad({ filter: IMAGE }, (args) => {
        assets += 1;
        const src = assetUrl(args.path, options.assetRoots, prefix);
        const value =
          options.images === "url" ? src : { src, ...imageSize(args.path) };
        return {
          contents: `export default ${JSON.stringify(value)};`,
          loader: "js",
        };
      });
      build.onLoad({ filter: SOUND }, (args) => ({
        contents: `export default ${JSON.stringify(assetUrl(args.path, options.assetRoots, prefix))};`,
        loader: "js",
      }));
      build.onLoad({ filter: /\.css$/ }, () => ({
        contents: "export default {};",
        loader: "js",
      }));
    },
  };
  fs.mkdirSync(options.outDir, { recursive: true });
  const common = {
    bundle: true,
    format: "esm" as const,
    platform: "browser" as const,
    target: "es2022",
    sourcemap: "inline" as const,
    minify: options.minify ?? false,
    alias: options.alias,
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
      ...options.define,
    },
    plugins: [assetsPlugin],
    logLevel: "silent" as const,
    jsx: "automatic" as const,
    loader: { ".glsl": "text" as const },
  };
  const app = path.join(options.outDir, "app.js");
  const worker = path.join(options.outDir, "viewer-worker.js");
  await Promise.all([
    esbuild.build({ ...common, entryPoints: [options.entry], outfile: app }),
    esbuild.build({
      ...common,
      entryPoints: [path.join(PACKAGE_ROOT, "src", "mesh-worker.ts")],
      outfile: worker,
      format: "iife",
    }),
  ]);
  return { app, worker, ms: Date.now() - started, assets };
}
