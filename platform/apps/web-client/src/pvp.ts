// Picking another player under the crosshair, for fighting players of a
// guild at war with yours (the server decides whether they may be hit).

export type Vec3 = { x: number; y: number; z: number };

/**
 * The nearest player whose body (a sphere of `radius` around the point
 * `drop` below their reported position) the ray from `origin` along the unit
 * vector `dir` meets within `reach`.
 */
export function pickPlayer(
  origin: Vec3,
  dir: Vec3,
  players: [string, Vec3][],
  reach = 4.5,
  radius = 0.6,
  drop = 0.5,
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const [id, p] of players) {
    const c = { x: p.x - origin.x, y: p.y - drop - origin.y, z: p.z - origin.z };
    const along = c.x * dir.x + c.y * dir.y + c.z * dir.z;
    if (along < 0 || along > reach + radius) continue;
    const off2 = c.x * c.x + c.y * c.y + c.z * c.z - along * along;
    if (off2 > radius * radius) continue;
    if (!best || along < best.distance) best = { id, distance: along };
  }
  return best;
}
