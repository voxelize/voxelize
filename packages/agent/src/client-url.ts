/**
 * The world a page's path names: its last segment, after any path prefix
 * the client is served under (`/play/world-a/` names `world-a`). One rule
 * for every side: `composeClientUrl` appends the world as that segment,
 * `composeWorldSwitchUrl` replaces it, and a host's bridge reports
 * `Snapshot.world` by it, so a world switch can tell when it has arrived.
 * Empty for a page at the root.
 */
export function worldFromPath(pathname: string): string {
  return (
    pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .pop() ?? ""
  );
}

/**
 * The URL a headless session opens. `base` is the client origin, optionally
 * with a path prefix and a query: a query survives, so a session can be
 * started on a share link (`/world?world=…&pos=…&look=…`) and land where the
 * link points, exactly as a person clicking it would.
 */
export function composeClientUrl(
  base: string,
  world: string,
  options: {
    agentName: string;
    isCapture?: boolean;
    isArmVisible?: boolean;
  },
): string {
  const target = new URL(base);
  const prefix = target.pathname.replace(/\/+$/, "");
  // A base that already names the world (a share link does) is not
  // doubled into `/test/test`.
  target.pathname =
    worldFromPath(prefix) === world ? prefix : `${prefix}/${world}`;
  target.searchParams.set("agent", "true");
  target.searchParams.set("agentName", options.agentName);
  if (options.isCapture) target.searchParams.set("capture", "true");
  if (options.isArmVisible) target.searchParams.set("agentArm", "true");
  return target.toString();
}

/** The query params `composeClientUrl` sets: what makes a page an agent's. */
const AGENT_PAGE_PARAMS = ["agent", "agentName", "capture", "agentArm"];

/**
 * The URL that opens `world` in place of the page at `currentUrl`: the same
 * origin and path prefix, the world as the last path segment, and only the
 * agent's own params carried over (a share link's position and look belong
 * to the world it was taken in).
 */
export function composeWorldSwitchUrl(
  currentUrl: string,
  world: string,
): string {
  const current = new URL(currentUrl);
  const next = new URL(current.origin);
  const segments = current.pathname.replace(/\/+$/, "").split("/");
  segments[Math.max(1, segments.length - 1)] = world;
  next.pathname = segments.join("/") || `/${world}`;
  for (const param of AGENT_PAGE_PARAMS) {
    const value = current.searchParams.get(param);
    if (value !== null) next.searchParams.set(param, value);
  }
  return next.toString();
}
