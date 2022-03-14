import { Component, Entity, System } from "@voxelize/common";
import { Server, PositionComponent } from "@voxelize/server";

const server = new Server({ port: 5000 });

const test = server.createRoom("test");

const BOX_SPEED = 0.001;

const TestFlyComponent = Component.register();

class Box extends Entity {
  constructor() {
    super();

    this.add(new TestFlyComponent());
  }
}

class UpdateBoxSystem extends System {
  constructor() {
    super([TestFlyComponent.type, PositionComponent.type]);
  }

  update(entity: Entity): void {
    const position = PositionComponent.get(entity).data;
    position.x += Math.cos(performance.now() * BOX_SPEED) * 0.005;
    position.y += Math.sin(performance.now() * BOX_SPEED) * 0.005;
    position.z += Math.sin(performance.now() * BOX_SPEED) * 0.005;
  }
}

test.world.addSystem(new UpdateBoxSystem());

test.world.registerEntity("Box", Box);

test.world.registerBlock("Orange", {
  faces: ["all"],
});
test.world.registerBlock("Grape", {
  faces: ["all"],
});

const box = test.world.addEntity("Box");
PositionComponent.get(box).data.set(3, 3, 3);

const box2 = test.world.addEntity("Box");
PositionComponent.get(box2).data.set(-3, 3, -3);

const test2 = server.createRoom("test2");

server.listen().then(({ port }) => {
  test.start();
  test2.start();
  console.log(`🚀  Server ready at http://localhost:${port}`);
});
