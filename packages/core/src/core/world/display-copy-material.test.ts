import { DoubleSide, FrontSide, MeshBasicMaterial, Texture } from "three";
import { describe, expect, it } from "vitest";

import {
  DISPLAY_COPY_ALPHA_TEST,
  displayCopyMaterialOptions,
} from "./display-copy-material";

describe("displayCopyMaterialOptions", () => {
  it("discards the empty texels of a see-through copy and still writes depth", () => {
    const map = new Texture();
    const material = new MeshBasicMaterial(
      displayCopyMaterialOptions({ isSeeThrough: true }, map),
    );
    expect(material.transparent).toBe(true);
    expect(material.alphaTest).toBe(DISPLAY_COPY_ALPHA_TEST);
    expect(material.depthWrite).toBe(true);
    expect(material.side).toBe(DoubleSide);
    expect(material.map).toBe(map);
  });

  it("matches the chunk see-through cut", () => {
    expect(DISPLAY_COPY_ALPHA_TEST).toBe(0.1);
  });

  it("leaves an opaque copy without an alpha test", () => {
    const material = new MeshBasicMaterial(
      displayCopyMaterialOptions({ isSeeThrough: false }, null),
    );
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0);
    expect(material.side).toBe(FrontSide);
  });
});
