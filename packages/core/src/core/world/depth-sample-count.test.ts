import { DepthTexture, WebGPUBackend } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { ownDepthSampleCount } from "./depth-sample-count";
import { placeholderTexture } from "./shading/uniforms";

// three's own code, with a renderer whose bound target is four-sampled (a
// thumbnail draw) and which multisamples itself (a capture page).
const primarySamples = (texture: DepthTexture) => {
  const backend = new WebGPUBackend();
  (backend as unknown as { renderer: unknown }).renderer = {
    samples: 4,
    currentSamples: 4,
  };
  return (
    backend as unknown as {
      utils: {
        getTextureSampleData(t: DepthTexture): { primarySamples: number };
      };
    }
  ).utils.getTextureSampleData(texture).primarySamples;
};

describe("depth texture sample counts", () => {
  it("leaves a depth texture without a target to whatever is bound", () => {
    expect(primarySamples(new DepthTexture(4, 4))).toBe(4);
  });

  it("keeps an owned depth texture at its own count", () => {
    expect(primarySamples(ownDepthSampleCount(new DepthTexture(4, 4), 0))).toBe(1);
    expect(primarySamples(ownDepthSampleCount(new DepthTexture(4, 4), 1))).toBe(1);
  });

  it("makes the depth placeholder single-sample", () => {
    expect(primarySamples(placeholderTexture("depth") as DepthTexture)).toBe(1);
  });
});
