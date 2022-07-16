import { Client } from "@voxelize/client";

export function setupEvents(client: Client) {
  client.events.on("TELEPORT", (payload) => {
    const [x, y, z] = payload;
    client.controls.setPosition(x, y, z);
  });
}
