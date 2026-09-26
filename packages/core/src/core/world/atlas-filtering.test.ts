import { NearestFilter, NearestMipmapNearestFilter } from "three";
import { describe, expect, it } from "vitest";

import { resolveAtlasFiltering } from "./textures";

describe("resolveAtlasFiltering", () => {
  it("keeps the original no-mip nearest sampling by default", () => {
    expect(resolveAtlasFiltering("nearest")).toEqual({
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      anisotropy: 1,
    });
  });

  it("builds a hard-edged mip chain plus anisotropy 4 for the glancing-angle fix", () => {
    expect(resolveAtlasFiltering("mip-aniso")).toEqual({
      minFilter: NearestMipmapNearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: true,
      anisotropy: 4,
    });
  });

  it("never changes magnification: up-close texels stay hard-edged either way", () => {
    expect(resolveAtlasFiltering("nearest").magFilter).toBe(NearestFilter);
    expect(resolveAtlasFiltering("mip-aniso").magFilter).toBe(NearestFilter);
  });

  it("only builds mips (and pays for them) in mip-aniso mode", () => {
    expect(resolveAtlasFiltering("nearest").generateMipmaps).toBe(false);
    expect(resolveAtlasFiltering("mip-aniso").generateMipmaps).toBe(true);
  });
});
