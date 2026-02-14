import {
  AABB,
  BlockRotation,
  BlockRuleEvaluator,
  BlockRuleLogic,
  createBlockFace,
  createBlockRule,
  createBlockConditionalPart,
  createBlockDynamicPattern,
  Light,
  LightUtils,
  Voxel,
} from "../dist/index.mjs";

const keyOf = (vx, vy, vz) => `${vx}:${vy}:${vz}`;

class MemorySpace {
  voxelMap = new Map();
  lightMap = new Map();

  setVoxel(vx, vy, vz, voxel) {
    this.voxelMap.set(keyOf(vx, vy, vz), voxel);
  }

  setLight(vx, vy, vz, light) {
    this.lightMap.set(keyOf(vx, vy, vz), light);
  }

  getRawVoxel(vx, vy, vz) {
    return this.voxelMap.get(keyOf(vx, vy, vz)) ?? 0;
  }

  getVoxel(vx, vy, vz) {
    return Voxel.id(this.getRawVoxel(vx, vy, vz));
  }

  getVoxelRotation(vx, vy, vz) {
    return Voxel.rotation(this.getRawVoxel(vx, vy, vz));
  }

  getVoxelStage(vx, vy, vz) {
    return Voxel.stage(this.getRawVoxel(vx, vy, vz));
  }

  getRawLight(vx, vy, vz) {
    return this.lightMap.get(keyOf(vx, vy, vz)) ?? 0;
  }

  getAllLights(vx, vy, vz) {
    return LightUtils.extractAll(this.getRawLight(vx, vy, vz));
  }
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = () => {
  const space = new MemorySpace();

  const voxelRotation = BlockRotation.encode(0, 6);
  const packedVoxel = Voxel.pack({
    id: 42,
    rotation: voxelRotation,
    stage: 7,
  });
  const packedLight = Light.pack({
    sunlight: 15,
    red: 10,
    green: 5,
    blue: 3,
  });

  space.setVoxel(0, 0, 0, packedVoxel);
  space.setLight(0, 0, 0, packedLight);

  const unpackedVoxel = Voxel.unpack(space.getRawVoxel(0, 0, 0));
  const unpackedLight = Light.unpack(space.getRawLight(0, 0, 0));

  assert(unpackedVoxel.id === 42, "Unexpected voxel id");
  assert(unpackedVoxel.stage === 7, "Unexpected voxel stage");
  assert(unpackedVoxel.rotation.equals(voxelRotation), "Unexpected voxel rotation");
  assert(unpackedLight.sunlight === 15, "Unexpected sunlight");
  assert(unpackedLight.red === 10, "Unexpected red light");
  assert(unpackedLight.green === 5, "Unexpected green light");
  assert(unpackedLight.blue === 3, "Unexpected blue light");

  const rotatedAabb = voxelRotation.rotateAABB(
    AABB.create(0, 0, 0, 1, 0.5, 1),
    true,
    true
  );
  assert(rotatedAabb.maxY > 0, "AABB rotation failed");

  const connectionRule = createBlockRule({
    type: "combination",
    logic: BlockRuleLogic.And,
    rules: [
      {
        type: "simple",
        offset: [0, 0, 0],
        id: 42,
      },
      {
        type: "simple",
        offset: [0, 0, 0],
        stage: 7,
      },
    ],
  });

  const matched = BlockRuleEvaluator.evaluate(connectionRule, [0, 0, 0], space);
  assert(matched, "Rule evaluation failed");
  const topFace = createBlockFace({
    name: "ConnectorTop",
    dir: [0, 1, 0],
  });
  const pattern = createBlockDynamicPattern({
    parts: [
      createBlockConditionalPart({
        rule: connectionRule,
        faces: [topFace],
        worldSpace: false,
      }),
    ],
  });
  const [patternPart] = pattern.parts;
  if (patternPart === undefined) {
    throw new Error("Dynamic pattern was not created.");
  }
  topFace.name = "MutatedConnectorTop";
  assert(patternPart.faces.length === 1, "Dynamic pattern face was not preserved");
  assert(
    patternPart.faces[0].name === "ConnectorTop",
    "Dynamic pattern face was not defensively cloned"
  );
  const patternMatched = BlockRuleEvaluator.evaluate(
    patternPart.rule,
    [0, 0, 0],
    space,
    {
      worldSpace: patternPart.worldSpace,
    }
  );
  assert(patternMatched, "Dynamic pattern evaluation failed");

  const serialized = JSON.stringify({
    voxel: space.getRawVoxel(0, 0, 0),
    light: space.getRawLight(0, 0, 0),
    bounds: {
      min: [rotatedAabb.minX, rotatedAabb.minY, rotatedAabb.minZ],
      max: [rotatedAabb.maxX, rotatedAabb.maxY, rotatedAabb.maxZ],
    },
  });

  const parsed = JSON.parse(serialized);
  assert(parsed.voxel === packedVoxel, "Serialization mismatch for voxel");
  assert(parsed.light === packedLight, "Serialization mismatch for light");

  console.log(
    JSON.stringify(
      {
        voxel: unpackedVoxel,
        light: unpackedLight,
        rotatedAabb: {
          min: [rotatedAabb.minX, rotatedAabb.minY, rotatedAabb.minZ],
          max: [rotatedAabb.maxX, rotatedAabb.maxY, rotatedAabb.maxZ],
        },
        ruleMatched: matched,
        patternMatched,
      },
      null,
      2
    )
  );
};

main();
