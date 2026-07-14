# @voxelize/agent

Headless puppeteer-backed agent SDK for Voxelize worlds. Launches a browser
that joins a world as a player, exposes an in-page control bridge, and serves
an HTTP daemon for driving the agent from scripts.

## Quick start

```bash
pnpm dev -- --url http://localhost:3000 --world terrain --port 4099
```

See `voxelize-agent --help` for all flags. The daemon listens on
`http://127.0.0.1:<port>` and exposes routes such as `/healthz`, `/me`,
`/snapshot`, `/screenshot`, `/act`, `/entities`, and `/events`.

## Health

`GET /healthz` reflects the real liveness of the whole chain, not just the
HTTP listener. It returns `200` with `{"ok": true, ...}` only when all of the
following hold:

- the browser process is alive and the DevTools connection is up,
- the page is open,
- the in-page agent bridge is installed and ready,
- the world snapshot (queried with a 3s timeout) reports ready.

Otherwise it returns `503` with `ok: false` and a `reasons` array naming each
failure (for example `"browser process is dead (pid 1234)"`), plus the raw
`browser`/`page`/`bridge`/`world` state. This exists because a killed browser
under a still-listening daemon used to keep answering `{ok:true}` forever, so
supervisors like PM2 never restarted the wrapper even though the agent had
been disconnected from the world.

The `voxelize-agent` wrapper also exits with code 1 when the browser
disconnects unexpectedly (process death, DevTools connection loss), so
PM2/systemd restart it instead of keeping a stale listener. Graceful
shutdowns (SIGINT/SIGTERM/SIGHUP, `agent.close()`) still exit 0. The same
signals are available programmatically via `agent.health()` and
`agent.onUnexpectedDisconnect(cb)`.

## Screenshots

`GET /screenshot` returns a PNG of the page. Query parameters:

| Parameter | Meaning |
| --- | --- |
| `pure` | `true`/`1` hides HUD overlays and returns only the WebGL canvas. |
| `width` | Capture-only viewport width in CSS pixels (integer, max 7680). |
| `height` | Capture-only viewport height in CSS pixels (integer, max 7680). |
| `scale` | Capture-only device scale factor (max 4). |

Without `width`/`height`/`scale`, the page is captured as-is at its current
viewport (1280x720 by default, configurable via `AGENT_VIEWPORT_WIDTH`,
`AGENT_VIEWPORT_HEIGHT`, and `AGENT_VIEWPORT_SCALE`).

### High-resolution captures

When any of `width`, `height`, or `scale` is passed, the page is resized for
that single capture and restored immediately afterwards (missing values fall
back to the current viewport). The final canvas backing store is
`width*scale` x `height*scale`, capped at 8K UHD (7680x4320 = 33,177,600
pixels).

```bash
# 3840x2160 (4K) backing canvas, pure WebGL frame:
curl 'http://127.0.0.1:4099/screenshot?pure=true&width=2560&height=1440&scale=1.5' -o shot.png
```

Invalid values (non-numeric, non-positive, fractional dimensions, or anything
over the caps) return HTTP 400 with an error message.

Why a temporary resize instead of running the browser at 4K? Under software
WebGL, every frame at 4K is roughly 9x the raster work of 720p. Heavy worlds
already saturate the main thread while streaming chunks during join/load, so
a permanently large viewport starves the network and chunk pipelines: the
agent stalls, misses pings, and can get disconnected. Joining at the
lightweight default viewport and only paying for high resolution inside the
capture window keeps the session healthy while still producing pure 4K (or up
to 8K) frames on demand.

The capture waits for the app to react to the resize (the canvas backing
store reaching the expected size, then a double `requestAnimationFrame`) both
after the resize and after the restoration, and the original viewport is
restored even if the capture fails.

The same options are available programmatically:

```ts
const png = await agent.screenshot({
  isPure: true,
  width: 2560,
  height: 1440,
  deviceScaleFactor: 1.5,
});
```
