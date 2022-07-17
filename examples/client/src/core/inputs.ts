import { BlockRotation, Client } from "@voxelize/client";

export function setupInputs(client: Client) {
  client.inputs.click(
    "left",
    () => {
      if (!client.controls.lookBlock) return;
      const [vx, vy, vz] = client.controls.lookBlock;
      client.world.updateVoxel(vx, vy, vz, 0);
      client.sounds.make("plop")?.play();
    },
    "in-game"
  );

  client.inputs.click(
    "middle",
    () => {
      if (!client.controls.lookBlock) return;
      const [vx, vy, vz] = client.controls.lookBlock;
      const block = client.world.getBlockByVoxel(vx, vy, vz);
      window.hand = block.name;
    },
    "in-game"
  );

  client.inputs.click(
    "right",
    () => {
      if (!window.hand) {
        return;
      }

      const { targetBlock } = client.controls;

      if (!targetBlock) return;
      const {
        voxel: [vx, vy, vz],
        rotation,
        yRotation,
      } = targetBlock;

      const id = client.world.getBlockByName(window.hand).id;

      if (!client.world.canPlace(vx, vy, vz, id)) {
        return;
      }

      const updated = client.world.getBlockById(id);
      for (const blockAABB of updated.aabbs) {
        if (
          client.controls.body.aabb.intersects(
            blockAABB.clone().translate([vx, vy, vz])
          )
        ) {
          return;
        }
      }

      client.sounds.make("plop")?.play();

      client.world.updateVoxel(
        vx,
        vy,
        vz,
        client.world.getBlockByName(window.hand).id,
        rotation ? BlockRotation.encode(rotation, yRotation) : undefined
      );
    },
    "in-game"
  );
}
