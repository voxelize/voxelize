/**
 * A utility class for doing DOM manipulation.
 *
 * @category Utils
 */
export class DOMUtils {
  private static toCssKey = (key: string) => {
    if (key.startsWith("--")) {
      return key;
    }
    let uppercaseCount = 0;
    for (let index = 0; index < key.length; index++) {
      const code = key.charCodeAt(index);
      if (code >= 65 && code <= 90) {
        uppercaseCount++;
      }
    }
    if (uppercaseCount === 0) {
      return key;
    }
    const chars = new Array<string>(key.length + uppercaseCount);
    let writeIndex = 0;
    for (let index = 0; index < key.length; index++) {
      const code = key.charCodeAt(index);
      if (code >= 65 && code <= 90) {
        chars[writeIndex++] = "-";
        chars[writeIndex++] = String.fromCharCode(code + 32);
      } else {
        chars[writeIndex++] = key[index];
      }
    }
    return chars.join("");
  };

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

    const elements = Array.isArray(ele) ? ele : [ele];
    const styleMap = style as Record<string, string | number | null | undefined>;
    const hasOwn = Object.prototype.hasOwnProperty;
    for (const key in styleMap) {
      if (!hasOwn.call(styleMap, key)) {
        continue;
      }
      const attribute = styleMap[key];
      if (attribute === undefined || attribute === null) {
        continue;
      }

      const value = String(attribute);
      const cssKey = DOMUtils.toCssKey(key);
      for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
        elements[elementIndex].style.setProperty(cssKey, value);
      }
    }

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
        DOMUtils.keyMap[String.fromCharCode(i + 32)] = `Key${char}`;
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
