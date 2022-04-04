import { Component, System } from "@voxelize/common";
import {
  Server,
  Position3DComponent,
  BaseEntity,
  TestVoxelStage,
} from "@voxelize/server";

const server = new Server({ port: 5000 });

const test = server.createRoom("test");

const BOX_SPEED = 0.001;

const TestFlyComponent = Component.register();

class Box extends BaseEntity {
  constructor() {
    super();

    this.add(new TestFlyComponent());
  }
}

class UpdateBoxSystem extends System {
  constructor() {
    super([TestFlyComponent.type, Position3DComponent.type]);
  }

  update(entity: BaseEntity): void {
    const position = Position3DComponent.get(entity).data;
    position.x += Math.cos(performance.now() * BOX_SPEED) * 0.005;
    position.y += Math.sin(performance.now() * BOX_SPEED) * 0.005;
    position.z += Math.sin(performance.now() * BOX_SPEED) * 0.005;
  }
}

test.world.addSystem(new UpdateBoxSystem());

test.world.registerEntity("Box", Box);

test.world.registerBlock("Marble", {
  faces: ["all"],
});

test.world.addStage(new TestVoxelStage());

const box = test.world.addEntity("Box");
Position3DComponent.get(box).data.set(3, 3, 3);

const box2 = test.world.addEntity("Box");
Position3DComponent.get(box2).data.set(-3, 3, -3);

const test2 = server.createRoom("test2");

server.listen().then(({ port }) => {
  test.start();
  test2.start();
  console.log(`🚀  Server ready at http://localhost:${port}`);
});
