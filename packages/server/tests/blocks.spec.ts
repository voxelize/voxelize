import assert from "assert";

import { Coords3 } from "@voxelize/common";

import { BlockRotation, Blocks } from "../src";

describe("Blocks", () => {
  describe("ID", () => {
    it("should work", () => {
      let voxel = 100230120;
      const id = 13;

      voxel = Blocks.insertId(voxel, id);
      assert.equal(Blocks.extractID(voxel), id);

      // Exceeded maximum
      voxel = Blocks.insertId(voxel, 65537);
      assert.equal(Blocks.extractID(voxel), 1);
    });
  });

  describe("Rotation insertion", () => {
    it("should work", () => {
      let voxel = 0;
      const id = 13;

      voxel = Blocks.insertId(voxel, id);
      assert.equal(Blocks.extractRotation(voxel), BlockRotation.PY);

      voxel = Blocks.insertRotation(voxel, BlockRotation.NX);
      assert.equal(Blocks.extractRotation(voxel), BlockRotation.NX);

      assert.equal(Blocks.extractID(voxel), id);
    });
  });

  describe("Rotation correctness", () => {
    it("should work", () => {
      const rotation = BlockRotation.PX;

      const compare = (a: Coords3, b: Coords3) => {
        assert.ok(Math.abs(a[0] - b[0]) < Number.EPSILON);
        assert.ok(Math.abs(a[1] - b[1]) < Number.EPSILON);
        assert.ok(Math.abs(a[2] - b[2]) < Number.EPSILON);
      };

      // default rotation at PY
      let point = [0.0, 1.0, 0.0] as Coords3;
      BlockRotation.rotate(rotation, point, false);
      compare(point, [1.0, 0.0, 0.0]);

      point = [0.0, 0.0, 1.0] as Coords3;
      BlockRotation.rotate(rotation, point, false);
      compare(point, [0.0, 0.0, 1.0]);
    });
  });

  describe("Stage", () => {
    it("should work", () => {
      let voxel = 0;
      const id = 13;

      voxel = Blocks.insertId(voxel, id);

      assert.equal(Blocks.extractStage(voxel), 0);

      for (let stage = 0; stage < 16; stage++) {
        voxel = Blocks.insertStage(voxel, stage);
        assert.equal(Blocks.extractStage(voxel), stage);
      }

      assert.equal(Blocks.extractID(voxel), id);
    });
  });
});
