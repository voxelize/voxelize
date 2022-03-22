import assert from "assert";

import ndarray from "ndarray";

import { Lights } from "../src";

describe("Lights", () => {
  [
    {
      name: "Red light",
      insert: "insertRedLight",
      extract: "extractRedLight",
    },
    {
      name: "Green light",
      insert: "insertGreenLight",
      extract: "extractGreenLight",
    },
    {
      name: "Blue light",
      insert: "insertBlueLight",
      extract: "extractBlueLight",
    },
    {
      name: "Sunlight",
      insert: "insertSunlight",
      extract: "extractSunlight",
    },
  ].forEach(({ name, insert, extract }) => {
    describe(name, () => {
      it("should work", () => {
        for (let level = 0; level < 16; level++) {
          let number = 0;

          number = Lights[insert](number, level);

          assert.equal(Lights[extract](number), level);
        }
      });
    });
  });

  describe("Worker functions", () => {
    it("should work", () => {
      const lights = ndarray<Uint32Array>(new Uint32Array(64), [4, 4, 4]);
      Lights.setSunlight(lights, 0, 0, 0, 15);
      assert.equal(Lights.getSunlight(lights, 0, 0, 0), 15);
    });
  });
});
