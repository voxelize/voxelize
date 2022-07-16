import { BlockUpdate, Client, ImageVoxelizer } from "@voxelize/client";

window.hand = "Stone";

export function setupCommands(client: Client) {
  client.chat.addCommand("image-voxelize", ImageVoxelizer.commander);

  client.chat.addCommand("hand", (rest: string, client: Client) => {
    const block = client.world.getBlockByName(rest.trim());

    if (block) {
      window.hand = block.name;
      client.chat.add({
        type: "INFO",
        body: "Client is now holding: " + block.name,
      });
    } else {
      const id = parseInt(rest, 10);

      if (!isNaN(id)) {
        const block = client.world.getBlockById(id);

        if (block) {
          window.hand = block.name;
          client.chat.add({
            type: "INFO",
            body: "Client is now holding: " + block.name,
          });
          return;
        }
      }

      client.chat.add({
        type: "ERROR",
        body: "Unknown block: " + rest,
      });
    }
  });

  client.chat.addCommand("blocks", (_, client: Client) => {
    const list: any[] = [];

    client.world.registry.blocksById.forEach((block, id) => {
      list.push([id, block]);
    });

    list.sort((a, b) => a[0] - b[0]);

    client.chat.add({
      type: "INFO",
      body: list.map(([id, block]) => `${id}: ${block.name}`).join("<br/>"),
    });
  });

  client.chat.addCommand("allblocks", (_, client: Client) => {
    const list: any[] = [];

    client.world.registry.blocksById.forEach((block, id) => {
      list.push([id, block]);
    });

    list.sort((a, b) => a[0] - b[0]);

    const [vx, vy, vz] = client.controls.voxel;

    const updates: BlockUpdate[] = [];
    for (let x = 0; x < list.length; x++) {
      const [id] = list[x];
      updates.push({ vx: vx + x, vy, vz, type: id });
    }

    client.world.setServerVoxels(updates);
  });
}
