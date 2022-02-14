import { Server, Entity } from "@voxelize/server";

const server = new Server({ port: 5000 });

const test = server.createRoom("test");

const BOX_SPEED = 0.001;

class Box extends Entity {
  onCreation = () => {
    this.setPosition(3, 3, 3);
  };

  update = () => {
    let { x, y, z } = this.position;
    x = Math.cos(performance.now() * BOX_SPEED) * 3;
    y += Math.sin(performance.now() * BOX_SPEED * 2) * 0.1;
    z = Math.sin(performance.now() * BOX_SPEED) * 3;
    this.setPosition(x, y, z);
  };
}

test.world.registerEntity("Box", Box);
test.world.addEntity("Box");

server.createRoom("test2");

server.listen().then(({ port }) => {
  console.log(`🚀  Server ready at http://localhost:${port}`);
});
