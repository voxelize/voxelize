import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ViewerAccess, ViewerServer } from "./server";

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-server-"));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Admits a request carrying `x-pass: admin`; `x-pass: player` is signed in but not allowed. */
async function decide(req: {
  headers: Record<string, unknown>;
}): Promise<ViewerAccess> {
  const pass = req.headers["x-pass"];
  if (pass === "admin") return { allowed: true };
  if (pass === "player")
    return { allowed: false, status: 403, message: "admins only" };
  return {
    allowed: false,
    status: 401,
    message: "sign in first",
    redirect: "https://game.example/sign-in",
  };
}

let server: ViewerServer;
let base = "";

beforeAll(async () => {
  const port = await freePort();
  server = new ViewerServer({
    port,
    cacheDir,
    readOnly: true,
    authorize: decide,
    page: { entry: path.join(cacheDir, "page.tsx"), assetRoots: [cacheDir] },
    resolveSource: () => Promise.reject(new Error("no sources in this test")),
    defaultSource: "none",
    stamp: "TEST",
    captureDir: () => cacheDir,
    idleTtlMs: 0,
  });
  await server.listen();
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close("test done");
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

const as = (pass: string | null, init: RequestInit = {}): RequestInit => ({
  ...init,
  redirect: "manual",
  headers: pass ? { "x-pass": pass } : {},
});

describe("a read-only viewer behind an authorize hook", () => {
  it("sends a browser that has not signed in to sign in, and tells the API why", async () => {
    const page = await fetch(`${base}/`, as(null));
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("https://game.example/sign-in");
    const api = await fetch(`${base}/api/state`, as(null));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "sign in first" });
    const asset = await fetch(`${base}/asset/0/x.png`, as(null));
    expect(asset.status).toBe(401);
  });

  it("refuses a signed-in player who is not allowed, without a sign-in loop", async () => {
    const page = await fetch(`${base}/`, as("player"));
    expect(page.status).toBe(403);
    expect(await page.text()).toBe("admins only");
  });

  it("serves the read-only routes to an allowed request", async () => {
    const ping = await fetch(`${base}/api/ping`, as("admin"));
    expect(ping.status).toBe(200);
    const bookmarks = await fetch(`${base}/api/bookmarks`, as("admin"));
    expect(bookmarks.status).toBe(200);
  });

  it("never writes a file, drives a browser or shuts down on request", async () => {
    for (const route of [
      "capture",
      "sheet",
      "page-shot",
      "session",
      "bookmarks",
      "shutdown",
    ]) {
      const reply = await fetch(
        `${base}/api/${route}`,
        as("admin", {
          method: "POST",
          body: JSON.stringify({ out: "/tmp/x" }),
        }),
      );
      expect(reply.status, route).toBe(403);
      expect((await reply.json()).error, route).toMatch(/read-only viewer/);
    }
    const alive = await fetch(`${base}/api/ping`, as("admin"));
    expect(alive.status).toBe(200);
  });
});
