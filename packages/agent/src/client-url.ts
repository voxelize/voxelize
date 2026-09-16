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
    prefix.split("/").pop() === world ? prefix : `${prefix}/${world}`;
  target.searchParams.set("agent", "true");
  target.searchParams.set("agentName", options.agentName);
  if (options.isCapture) target.searchParams.set("capture", "true");
  if (options.isArmVisible) target.searchParams.set("agentArm", "true");
  return target.toString();
}
