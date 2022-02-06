import { Server } from "@voxelize/server";

const server = new Server({ port: 5000, peerPort: 443 });
server.start();
