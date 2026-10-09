/**
 * A plain DOM toolbar for pages without a UI kit of their own (the
 * engine's demo). A host with its own components drives the same
 * `WorldViewer` methods instead.
 */
import type { Bookmark } from "./pose";
import { PRESETS } from "./pose";
import type { WorldViewer } from "./viewer";

export function mountToolbar(
  viewer: WorldViewer,
  parent: HTMLElement,
  bookmarks: Bookmark[] = [],
): () => void {
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:absolute;top:8px;left:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;" +
    "padding:6px 8px;background:rgba(12,14,18,0.82);color:#eee;font:12px sans-serif;border-radius:6px;max-width:calc(100% - 16px)";
  const button = (text: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.onclick = onClick;
    bar.append(b);
    return b;
  };
  const toggle = (
    key: "water" | "plants" | "far" | "shadows" | "hud",
    text: string,
  ) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = viewer.options[key];
    box.onchange = () => viewer.setOptions({ [key]: box.checked });
    label.append(box, ` ${text}`);
    bar.append(label);
  };
  for (const preset of PRESETS) button(preset, () => viewer.setPreset(preset));
  const time = document.createElement("input");
  time.type = "range";
  time.min = "0";
  time.max = "1";
  time.step = "0.01";
  time.value = String(viewer.options.time);
  time.oninput = () => viewer.setOptions({ time: Number(time.value) });
  bar.append("time ", time);
  toggle("water", "water");
  toggle("plants", "plants");
  toggle("far", "far");
  toggle("shadows", "shadows");
  toggle("hud", "hud");
  for (const overlay of viewer.availableOverlays()) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = viewer.options.overlays.includes(overlay.id);
    box.onchange = () => {
      const rest = viewer.options.overlays.filter((id) => id !== overlay.id);
      viewer.setOptions({
        overlays: box.checked ? [...rest, overlay.id] : rest,
      });
    };
    label.append(box, ` ${overlay.label}`);
    bar.append(label);
  }
  if (bookmarks.length) {
    const select = document.createElement("select");
    select.append(new Option("bookmarks…", ""));
    for (const b of bookmarks) select.append(new Option(b.label, b.id));
    select.onchange = () => {
      const b = bookmarks.find((x) => x.id === select.value);
      if (b) viewer.setPose(b.pose, b.preset ?? viewer.rig.preset);
      select.value = "";
    };
    bar.append(select);
  }
  const link = button("copy share link", () => {
    const url = viewer.shareLink();
    if (url) void navigator.clipboard?.writeText(url);
  });
  link.title = "the game's link for this pose";
  parent.append(bar);
  return () => bar.remove();
}
