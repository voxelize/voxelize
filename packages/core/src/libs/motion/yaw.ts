export function shortestYawDelta(fromY: number, toY: number): number {
  return Math.atan2(Math.sin(toY - fromY), Math.cos(toY - fromY));
}
