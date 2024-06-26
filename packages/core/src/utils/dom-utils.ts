/**
 * A utility class for doing DOM manipulation.
 *
 * @category Utils
 */
export class DOMUtils {
  /**
   * Apply styles directly onto DOM element(s).
   *
   * @param ele The element(s) to add styles to.
   * @param style The style(s) to add.
   * @returns The element(s) with the added styles.
   */
  static applyStyles = (
    ele: HTMLElement | HTMLElement[] | undefined,
    style: Partial<CSSStyleDeclaration>
  ) => {
    if (!ele) return;

    Object.keys(style).forEach((key: string) => {
      // @ts-ignore
      const attribute = style[key];
      if (Array.isArray(ele)) {
        ele.forEach((e: any) => (e.style[key] = attribute));
      } else {
        // @ts-ignore
        ele.style[key] = attribute;
      }
    });

    return ele;
  };

  /**
   * Create a CSS color string from numbers.
   *
   * @param r Red channel
   * @param g Green channel
   * @param b Blue channel
   * @param a Alpha channel
   * @returns A CSS color string
   */
  static rgba = (r: number, g: number, b: number, a: number) => {
    return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
  };

  private static keyMap: { [key: string]: string } | null = null;

  static mapKeyToCode = (key: string) => {
    if (!DOMUtils.keyMap) {
      DOMUtils.keyMap = {
        ArrowUp: "KeyW",
        ArrowDown: "KeyS",
        ArrowLeft: "KeyA",
        ArrowRight: "KeyD",
        Space: "Space",
        ShiftLeft: "ShiftLeft",
        ShiftRight: "ShiftRight",
        ControlLeft: "ControlLeft",
        ControlRight: "ControlRight",
        AltLeft: "AltLeft",
        AltRight: "AltRight",
        Enter: "Enter",
        Escape: "Escape",
        Tab: "Tab",
        "/": "Slash",
        ".": "Period",
        ",": "Comma",
        ";": "Semicolon",
        "'": "Quote",
        "[": "BracketLeft",
        "]": "BracketRight",
        "\\": "Backslash",
        "-": "Minus",
        "=": "Equal",
        "`": "Backquote",
      };

      // Handle regular a-z keys
      for (let i = 65; i <= 90; i++) {
        const char = String.fromCharCode(i);
        DOMUtils.keyMap[char.toLowerCase()] = `Key${char}`;
      }

      // Handle number keys
      for (let i = 0; i <= 9; i++) {
        DOMUtils.keyMap[i.toString()] = `Digit${i}`;
      }
    }

    return DOMUtils.keyMap[key] || key;
  };

  private constructor() {
    // NOTHING
  }
}
