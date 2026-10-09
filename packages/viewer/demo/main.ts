/**
 * The viewer over the demo's generated worlds, painted by the demo client's
 * own texture setup (`examples/client/src/world.ts`).
 */
import { setupWorld } from "../../../examples/client/src/world";
import {
  type Bookmark,
  DEFAULT_OPTIONS,
  installControl,
  mountToolbar,
  readUrl,
  WorldViewer,
} from "../src";

async function json<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

async function start() {
  const container = document.getElementById("viewer");
  if (!container) throw new Error("the demo page has no #viewer element");
  const request = readUrl(window.location.search, {
    ...DEFAULT_OPTIONS,
    overlays: [],
  });
  const state = await json<{ defaultSource: string; bookmarks: Bookmark[] }>(
    "/api/state",
  );
  const viewer = new WorldViewer(container, {
    setupTextures: (world) =>
      setupWorld(world as Parameters<typeof setupWorld>[0]),
  });
  viewer.setOptions(request.options);
  installControl(viewer, state.bookmarks, request.options);
  if (new URLSearchParams(window.location.search).get("session") === "1")
    return;
  const source = await json<{ id: string; label: string }>("/api/sources", {
    spec: request.a ?? state.defaultSource,
  });
  await viewer.setSources(source);
  const home = state.bookmarks[0];
  if (request.pose) viewer.setPose(request.pose, request.preset ?? "orbit");
  else if (home) viewer.setPose(home.pose, home.preset ?? "orbit");
  mountToolbar(viewer, document.body, state.bookmarks);
}

void start();
