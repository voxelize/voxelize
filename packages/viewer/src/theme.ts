/**
 * How the viewer's own interface looks: pin tags, the pin card, the action
 * wheel and its toasts. Everything is square, bevelled and stepped, drawn
 * in a pixel font with pixel icons, so a host can dress it in its game's
 * panels by handing over colours, a font and 16x16 icons.
 */

export type ViewerTheme = {
  /** CSS font-family for every label the viewer draws; a pixel font reads best. */
  font: string;
  /** CSS pixels; a whole multiple of the font's pixel grid keeps it crisp. */
  fontSize: number;
  /** Panel fill. */
  panel: string;
  /** Fill of a highlighted wheel slot. */
  panelRaised: string;
  /** Bevel highlight on the top and left edges. */
  edgeLight: string;
  /** Bevel shadow on the bottom and right edges. */
  edgeDark: string;
  /** The rim of whatever is selected or highlighted. */
  accent: string;
  text: string;
  textMuted: string;
  /** Hard drop shadow under panels. */
  shadow: string;
  /** Pixel-art outline colour (pin model, measuring line). */
  outline: string;
  /** Banner colours, cycled per pin. */
  pinCloth: string[];
  /** The banner's pole. */
  pinPole: string;
  /** The finial on top of the pole. */
  pinCap: string;
  /** The letter on the banner. */
  pinLetter: string;
  /** Icon image URLs (16x16 pixel art) by action id; missing ones use the built-in set. */
  icons: Partial<Record<string, string>>;
};

export const DEFAULT_THEME: Readonly<ViewerTheme> = Object.freeze({
  font: "monospace",
  fontSize: 13,
  panel: "#1d2026",
  panelRaised: "#2c313a",
  edgeLight: "#454b56",
  edgeDark: "#0b0c0f",
  accent: "#9fb4c8",
  text: "#e8ecf1",
  textMuted: "#98a2ae",
  shadow: "rgba(0, 0, 0, 0.45)",
  outline: "#101216",
  pinCloth: ["#a33b35", "#3a6fa8", "#4d8a3c", "#b08a2e", "#7a4b9a"],
  pinPole: "#6b5034",
  pinCap: "#c9b37a",
  pinLetter: "#efe6d8",
  icons: {},
});

/** The stylesheet for one viewer instance; class names are scoped by `prefix`. */
export function themeCss(theme: ViewerTheme, prefix: string): string {
  const p = `.${prefix}`;
  const bevel = `border: 2px solid; border-color: ${theme.edgeLight} ${theme.edgeDark} ${theme.edgeDark} ${theme.edgeLight};`;
  return `
${p}-ui { position: absolute; inset: 0; pointer-events: none; overflow: hidden;
  font-family: ${theme.font}; font-size: ${theme.fontSize}px; line-height: 1.25;
  color: ${theme.text}; user-select: none; -webkit-user-select: none; }
${p}-ui img { image-rendering: pixelated; image-rendering: crisp-edges; }
${p}-panel { background: ${theme.panel}; ${bevel} box-shadow: 3px 3px 0 ${theme.shadow}; }
${p}-tag { position: absolute; left: 0; top: 0; padding: 1px 5px; white-space: nowrap;
  background: ${theme.panel}; ${bevel} box-shadow: 2px 2px 0 ${theme.shadow}; }
${p}-tag.is-selected { border-color: ${theme.accent}; }
${p}-card { position: absolute; left: 0; top: 0; padding: 6px 8px; min-width: 150px; }
${p}-card-title { color: ${theme.accent}; margin-bottom: 3px; }
${p}-row { display: flex; justify-content: space-between; gap: 12px; }
${p}-row span:first-child { color: ${theme.textMuted}; }
${p}-card-actions { display: flex; gap: 4px; margin-top: 6px; pointer-events: auto; }
${p}-card-button { display: flex; align-items: center; gap: 4px; padding: 2px 6px 2px 3px;
  font: inherit; color: ${theme.text}; background: ${theme.panelRaised}; ${bevel} cursor: pointer; }
${p}-card-button img { width: 16px; height: 16px; }
${p}-card-button:hover:not(:disabled) { border-color: ${theme.accent}; }
${p}-card-button:active:not(:disabled) { border-color: ${theme.edgeDark} ${theme.edgeLight} ${theme.edgeLight} ${theme.edgeDark}; }
${p}-card-button:disabled { opacity: 0.4; cursor: default; }
${p}-card-more { margin-top: 4px; color: ${theme.textMuted}; font-size: ${Math.max(8, theme.fontSize - 3)}px; }
${p}-wheel { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: auto; }
${p}-slot { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  display: flex; align-items: center; justify-content: center;
  background: ${theme.panel}; ${bevel} box-shadow: 3px 3px 0 ${theme.shadow};
  transition: transform 96ms steps(3, end), opacity 96ms steps(3, end); }
${p}-slot img { width: 32px; height: 32px; }
${p}-slot.is-hot { background: ${theme.panelRaised}; border-color: ${theme.accent}; margin-top: -24px; }
${p}-slot.is-off { opacity: 0.4; }
${p}-key { position: absolute; right: 1px; bottom: -1px; font-size: ${Math.max(8, theme.fontSize - 3)}px;
  color: ${theme.textMuted}; }
${p}-hub { position: absolute; left: 0; top: 0; padding: 4px 8px; text-align: center; white-space: nowrap; }
${p}-pip { position: absolute; width: 6px; height: 6px; margin: -3px 0 0 -3px; background: ${theme.accent};
  box-shadow: 0 0 0 2px ${theme.outline}; }
${p}-hub-sub { color: ${theme.textMuted}; }
${p}-toast { position: absolute; left: 0; top: 0; padding: 4px 8px; white-space: nowrap; }
${p}-measure { position: absolute; left: 0; top: 0; padding: 4px 8px; white-space: nowrap; }
`;
}
