class Helper {
  static applyStyles = (
    ele: HTMLElement | HTMLElement[],
    style: Partial<CSSStyleDeclaration>
  ) => {
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
}

export { Helper };
