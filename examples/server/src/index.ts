import { Server } from "@voxelize/server";

const server = new Server({ port: 5000 });

server.createRoom("test");
server.createRoom("test2");

server.listen().then(({ port }) => {
  console.log(`🚀  Server ready at http://localhost:${port}`);
});
