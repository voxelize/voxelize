import { Server, Entity } from "@voxelize/server";

const server = new Server({ port: 5000 });

const test = server.createRoom("test");

const BOX_SPEED = 0.001;

class Box extends Entity {
  update = () => {
    let { x, y, z } = this.position;
    x += Math.cos(performance.now() * BOX_SPEED) * 0.005;
    y += Math.sin(performance.now() * BOX_SPEED) * 0.005;
    z += Math.sin(performance.now() * BOX_SPEED) * 0.005;
    this.setPosition(x, y, z);
  };
}

test.world.registerEntity("Box", Box);

const box = test.world.addEntity("Box");
box.setPosition(3, 3, 3);

const box2 = test.world.addEntity("Box");
box2.setPosition(-3, 3, -3);

server.createRoom("test2");

server.listen().then(({ port }) => {
  console.log(`🚀  Server ready at http://localhost:${port}`);
});
