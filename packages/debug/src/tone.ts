export type Tone = "neutral" | "ok" | "warn" | "error";

const TONE_VARIABLES: Record<Tone, string> = {
  neutral: "--vxd-fg-value",
  ok: "--vxd-accent",
  warn: "--vxd-accent-warning",
  error: "--vxd-accent-error",
};

const TONE_FALLBACKS: Record<Tone, string> = {
  neutral: "#f5f5f5",
  ok: "#5fb86b",
  warn: "#d6a44e",
  error: "#d04a4a",
};

export const resolveToneColors = (
  element: HTMLElement,
): Record<Tone, string> => {
  const computed = getComputedStyle(element);
  const colors = {} as Record<Tone, string>;
  for (const tone of Object.keys(TONE_VARIABLES) as Tone[]) {
    const value = computed.getPropertyValue(TONE_VARIABLES[tone]).trim();
    colors[tone] = value || TONE_FALLBACKS[tone];
  }
  return colors;
};
