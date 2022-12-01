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

  private constructor() {
    // NOTHING
  }
}
