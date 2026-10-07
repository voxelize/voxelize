// Weather and status effects on the client: rain or snow falling around the
// camera, a darker sky in storms, lightning flashes; and what effects change
// for the player's own body (speed, jumping, night vision) plus a list of
// those running. The server decides the weather and the effects.

import * as THREE from "three";

export type WeatherInfo = { kind: "clear" | "rain" | "thunder"; precipitation: "rain" | "snow" | "none" };
export type EffectInfo = { kind: string; level: number; seconds: number };

const DROPS = 1200;
const SPAN = 24;

/** How dark the sky tint is for a weather. */
export function tint(w: WeatherInfo): number {
  return w.kind === "thunder" ? 0.45 : w.kind === "rain" ? 0.25 : 0;
}

/** Movement for the effects running: a speed factor and a jump factor. */
export function movement(effects: EffectInfo[]): { speed: number; jump: number } {
  const level = (k: string) => effects.find((e) => e.kind === k)?.level;
  const speed = level("speed");
  const slow = level("slowness");
  const jump = level("jump_boost");
  return {
    speed: Math.max(0.2, 1 + (speed !== undefined ? 0.2 * (speed + 1) : 0) - (slow !== undefined ? 0.15 * (slow + 1) : 0)),
    jump: jump !== undefined ? 1 + 0.25 * (jump + 1) : 1,
  };
}

const NAMES: Record<string, string> = {
  speed: "Speed",
  slowness: "Slowness",
  strength: "Strength",
  weakness: "Weakness",
  regeneration: "Regeneration",
  poison: "Poison",
  resistance: "Resistance",
  fire_resistance: "Fire Resistance",
  night_vision: "Night Vision",
  water_breathing: "Water Breathing",
  jump_boost: "Jump Boost",
  hunger: "Hunger",
};

/** "Strength II 2:05" */
export function effectLine(e: EffectInfo): string {
  const s = Math.max(0, Math.ceil(e.seconds));
  return `${NAMES[e.kind] ?? e.kind} ${["I", "II", "III", "IV", "V"][e.level] ?? e.level + 1} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export class WeatherView {
  readonly points: THREE.Points;
  private weather: WeatherInfo = { kind: "clear", precipitation: "rain" };
  private positions = new Float32Array(DROPS * 3);
  private material = new THREE.PointsMaterial({ color: 0xa8c4ff, size: 0.12, transparent: true, opacity: 0.6, depthWrite: false });

  constructor() {
    for (let i = 0; i < DROPS; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * SPAN;
      this.positions[i * 3 + 1] = Math.random() * SPAN;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * SPAN;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  set(w: WeatherInfo) {
    this.weather = w;
    const falling = w.kind !== "clear" && w.precipitation !== "none";
    this.points.visible = falling;
    const snow = w.precipitation === "snow";
    this.material.color.setHex(snow ? 0xffffff : 0xa8c4ff);
    this.material.size = snow ? 0.18 : 0.1;
    const shade = document.getElementById("weather-tint");
    if (shade) shade.style.opacity = String(tint(w));
  }

  update(camera: THREE.Vector3, dt: number) {
    if (!this.points.visible) return;
    const snow = this.weather.precipitation === "snow";
    const fall = (snow ? 2 : 14) * dt;
    for (let i = 0; i < DROPS; i++) {
      let y = this.positions[i * 3 + 1] - fall;
      if (y < 0) y += SPAN;
      this.positions[i * 3 + 1] = y;
      if (snow) this.positions[i * 3] += Math.sin(y + i) * 0.01;
    }
    this.points.position.set(camera.x, camera.y - SPAN / 2, camera.z);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/** A white flash for lightning. */
export function flash() {
  const el = document.getElementById("lightning");
  if (!el) return;
  el.style.transition = "none";
  el.style.opacity = "0.8";
  requestAnimationFrame(() => {
    el.style.transition = "opacity 0.4s";
    el.style.opacity = "0";
  });
}
