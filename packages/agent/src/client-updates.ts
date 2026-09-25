/**
 * Dev-server hot updates, held back from agent pages.
 *
 * A dev server pushes every source edit to every open tab over its HMR
 * socket. An agent page that applies one mid-capture loses what it was
 * doing, and one the framework cannot apply in place becomes a full reload:
 * the page rejoins at spawn and the staging is gone. On a machine where
 * several people edit the client, that was a reset every few minutes.
 *
 * So an agent page keeps the code it loaded. Before any page script runs,
 * `WebSocket` is wrapped for HMR URLs only: the page gets a socket that
 * opens once and never reports a close or an error, and receives only the
 * connect handshake. Every later message (updates, reload requests, a
 * restarted server's new session) is held and counted, never delivered.
 * Underneath, a real socket stays connected, reconnecting quietly and
 * replaying the page's subscriptions, so the count stays true across
 * dev-server restarts. `live` mode skips all of this.
 *
 * The frameworks' own reload paths (a reconnect limit, a changed server
 * session) all run through that socket, which is why blocking the endpoint
 * outright would not work: a refused socket is a reload after a dozen
 * retries.
 */

/** `hold` (default) keeps the loaded client code; `live` follows the dev server. */
export const CLIENT_UPDATES_ENV = "AGENT_CLIENT_UPDATES";
/** Comma-separated substrings; a WebSocket URL containing one is an HMR socket. */
export const HMR_URL_PATTERNS_ENV = "AGENT_HMR_URL_PATTERNS";
/** Next.js app router (`/_next/hmr`) and the webpack pages router. */
export const DEFAULT_HMR_URL_PATTERNS = ["/_next/hmr", "/_next/webpack-hmr"];
/** Messages closer together than this are one edit's update. */
export const DEFAULT_UPDATE_BURST_GAP_MS = 1_000;

export type ClientUpdateMode = "hold" | "live";

export type ClientUpdateState = {
  mode: "hold";
  installedAt: number;
  /** Whether the real socket underneath is connected right now. */
  isConnected: boolean;
  /** Distinct updates (edits) held back since this document loaded. */
  updates: number;
  /** Every message held back, updates or not. */
  heldMessages: number;
  lastUpdateAt: number | null;
  lastUpdateTypes: string[];
  /** Times the dev server came back with a new session (its code moved on). */
  serverRestarts: number;
  reconnects: number;
};

declare global {
  interface Window {
    __agentClientUpdates__?: ClientUpdateState;
  }
}

export function resolveClientUpdateMode(
  env: NodeJS.ProcessEnv = process.env,
): ClientUpdateMode {
  return (env[CLIENT_UPDATES_ENV] ?? "").trim().toLowerCase() === "live"
    ? "live"
    : "hold";
}

export function resolveHmrUrlPatterns(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env[HMR_URL_PATTERNS_ENV];
  if (raw === undefined || raw.trim() === "") return DEFAULT_HMR_URL_PATTERNS;
  return raw
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

/**
 * Runs inside the page before its own scripts (it is serialized with
 * `toString`), so it must stay self-contained: no imports, no module-scope
 * references, and no syntax the build lowers into helpers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clientUpdateGuard(
  root: any,
  patterns: string[],
  burstGapMs: number,
): void {
  const Native = root.WebSocket;
  if (typeof Native !== "function" || root.__agentClientUpdates__) return;
  // Everything a dev server sends after connecting that would change or
  // reload the page. Unknown types are held too, just not counted.
  const UPDATE_TYPES = [
    "turbopack-message",
    "serverComponentChanges",
    "reloadPage",
    "clientChanges",
    "serverOnlyChanges",
    "addedPage",
    "removedPage",
    "middlewareChanges",
    "staticParamsChanged",
    "devPagesManifestUpdate",
    "turbopack-connected",
  ];
  // webpack applies code through these; Turbopack broadcasts them to every
  // tab after any compile anywhere, so there they are held but not counted
  // (its code for this page arrives as turbopack-message).
  const WEBPACK_UPDATE_TYPES = ["built", "sync"];
  // Delivered once each: the page needs the handshake to register its
  // chunks, which is also what makes the server send updates to count.
  // `built` is not one: it follows a rebuild and carries the hash that
  // applies it.
  const HANDSHAKE_TYPES = ["turbopack-connected", "sync"];
  const PASS_TYPES = [
    "devIndicator",
    "devtoolsConfig",
    "cacheIndicator",
    "isrManifest",
  ];
  const MAX_RETRY_MS = 30_000;
  const state = {
    mode: "hold",
    installedAt: Date.now(),
    isConnected: false,
    updates: 0,
    heldMessages: 0,
    lastUpdateAt: null as number | null,
    lastUpdateTypes: [] as string[],
    serverRestarts: 0,
    reconnects: 0,
  };
  root.__agentClientUpdates__ = state;

  const isHmrUrl = (url: unknown) => {
    const text = String(url);
    return patterns.some((pattern) => text.indexOf(pattern) !== -1);
  };

  const hold = (type: string, isUpdate: boolean) => {
    state.heldMessages += 1;
    if (!isUpdate) return;
    const now = Date.now();
    if (state.lastUpdateAt === null || now - state.lastUpdateAt > burstGapMs) {
      state.updates += 1;
      state.lastUpdateTypes = [];
    }
    state.lastUpdateAt = now;
    if (
      state.lastUpdateTypes.indexOf(type) === -1 &&
      state.lastUpdateTypes.length < 8
    ) {
      state.lastUpdateTypes.push(type);
    }
  };

  const createGuardedSocket = (url: unknown, protocols: unknown) => {
    const facade = new root.EventTarget();
    let readyState = 0;
    let binaryType = "blob";
    let real: any = null;
    let isClosedByPage = false;
    let retryTimer: any = null;
    let retryDelayMs = 1_000;
    let firstSessionId: unknown = undefined;
    let isTurbopack = false;
    const delivered: string[] = [];
    const subscriptions = new Map<string, string>();

    Object.defineProperties(facade, {
      url: { value: String(url) },
      protocol: { get: () => (real ? real.protocol : "") },
      extensions: { get: () => "" },
      bufferedAmount: { get: () => 0 },
      readyState: { get: () => readyState },
      binaryType: {
        get: () => binaryType,
        set: (value: string) => {
          binaryType = value;
          if (real) real.binaryType = value;
        },
      },
      CONNECTING: { value: 0 },
      OPEN: { value: 1 },
      CLOSING: { value: 2 },
      CLOSED: { value: 3 },
    });
    facade.onopen = null;
    facade.onmessage = null;
    facade.onerror = null;
    facade.onclose = null;

    const emit = (type: string, data?: unknown) => {
      const event =
        type === "message"
          ? new root.MessageEvent("message", { data })
          : new root.Event(type);
      const handler = facade[`on${type}`];
      if (typeof handler === "function") {
        try {
          handler.call(facade, event);
        } catch (error) {
          setTimeout(() => {
            throw error;
          });
        }
      }
      facade.dispatchEvent(event);
    };

    const remember = (data: unknown) => {
      if (typeof data !== "string") return;
      let message: any;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      const type =
        message && typeof message.type === "string" ? message.type : "";
      const key = (suffix: string) =>
        `${type.slice(0, -suffix.length)}:${JSON.stringify(
          message.path ?? null,
        )}`;
      if (type.endsWith("-unsubscribe")) {
        subscriptions.delete(key("-unsubscribe"));
      } else if (type.endsWith("-subscribe")) {
        subscriptions.set(key("-subscribe"), data);
      }
    };

    facade.send = (data: unknown) => {
      if (readyState === 0) {
        throw new root.DOMException(
          "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
          "InvalidStateError",
        );
      }
      remember(data);
      if (real && real.readyState === 1) real.send(data);
    };
    facade.close = () => {
      isClosedByPage = true;
      readyState = 3;
      clearTimeout(retryTimer);
      if (real) {
        try {
          real.close();
        } catch {
          // already closing
        }
      }
    };

    const onRealMessage = (event: any) => {
      // Binary frames carry this request's own React debug chunks and error
      // state, never code; the page's first render waits on them.
      if (typeof event.data !== "string") {
        emit("message", event.data);
        return;
      }
      let type: string | null = null;
      let sessionId: unknown = undefined;
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          const raw = message && (message.type ?? message.action);
          type = typeof raw === "string" ? raw : null;
          sessionId =
            message && message.data ? message.data.sessionId : undefined;
        } catch {
          type = null;
        }
      }
      if (type === "turbopack-connected") {
        isTurbopack = true;
        if (firstSessionId === undefined) {
          firstSessionId = sessionId ?? null;
          delivered.push(type);
          emit("message", event.data);
          return;
        }
        if (sessionId !== firstSessionId) state.serverRestarts += 1;
      } else if (
        type !== null &&
        HANDSHAKE_TYPES.indexOf(type) !== -1 &&
        delivered.indexOf(type) === -1
      ) {
        delivered.push(type);
        emit("message", event.data);
        return;
      } else if (type !== null && PASS_TYPES.indexOf(type) !== -1) {
        emit("message", event.data);
        return;
      }
      const isUpdate =
        type !== null &&
        (UPDATE_TYPES.indexOf(type) !== -1 ||
          (!isTurbopack && WEBPACK_UPDATE_TYPES.indexOf(type) !== -1));
      hold(type ?? "binary", isUpdate);
    };

    const scheduleRetry = () => {
      if (isClosedByPage) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS);
    };

    function connect() {
      if (isClosedByPage) return;
      let socket: any;
      try {
        socket =
          protocols === undefined
            ? new Native(url)
            : new Native(url, protocols);
      } catch {
        scheduleRetry();
        return;
      }
      real = socket;
      socket.binaryType = binaryType;
      socket.onopen = () => {
        state.isConnected = true;
        retryDelayMs = 1_000;
        if (readyState === 0) {
          readyState = 1;
          emit("open");
          return;
        }
        state.reconnects += 1;
        subscriptions.forEach((data) => {
          try {
            socket.send(data);
          } catch {
            // the next reconnect replays it again
          }
        });
      };
      socket.onmessage = onRealMessage;
      // Swallowed on purpose: a dev server that went away must not look
      // like one to the page, whose reaction to that is a reload.
      socket.onerror = () => undefined;
      socket.onclose = () => {
        state.isConnected = false;
        if (real === socket) real = null;
        scheduleRetry();
      };
    }

    connect();
    return facade;
  };

  root.WebSocket = new Proxy(Native, {
    construct(target: any, args: any[], newTarget: any) {
      if (isHmrUrl(args[0])) return createGuardedSocket(args[0], args[1]);
      return Reflect.construct(target, args, newTarget);
    },
  });
}

/** The init script an agent page runs before its own code. */
export function clientUpdateGuardSource(
  patterns: string[],
  burstGapMs = DEFAULT_UPDATE_BURST_GAP_MS,
): string {
  return `(${clientUpdateGuard.toString()})(window, ${JSON.stringify(
    patterns,
  )}, ${burstGapMs});`;
}
