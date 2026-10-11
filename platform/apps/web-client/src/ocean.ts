// The Ocean on screen: the deeper the darker (a blue veil over the view,
// thickest in the abyss), and each depth zone named as the player enters
// it. The server decides the zones (docs/NETWORK_PROTOCOL.md, platform.zone).

/** The sea's surface (the world's water level). */
export const SURFACE = 120;

/** How thick the veil is at an eye height: 0 at the surface, 0.7 deep in the abyss. */
export function depthShade(eyeY: number): number {
  const depth = Math.max(0, SURFACE - eyeY);
  return Math.min(0.7, (depth / 100) * 0.7);
}

/** What the player is told on entering a zone. */
export function zoneLine(zone: string, name: string): string {
  return zone === "abyss" ? `${name}: the deep crushes those without a helm` : name;
}

export class DepthVeil {
  private readonly root: HTMLElement;
  private last = -1;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "depth-veil";
    document.body.append(this.root);
  }

  update(eyeY: number) {
    const shade = Math.round(depthShade(eyeY) * 100) / 100;
    if (shade === this.last) return;
    this.last = shade;
    this.root.style.opacity = String(shade);
  }
}
