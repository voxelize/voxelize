const { Transport } = require("../dist/index.js");

const transport = new Transport();

transport.connect("ws://127.0.0.1:4000/", "test").then(() => {
  const setVoxel = (vx, vy, vz, type) =>
    transport.send({
      type: "UPDATE",
      text: "flat",
      updates: [
        {
          vx,
          vy,
          vz,
          voxel: type,
        },
      ],
    });
  setInterval(() => {
    setVoxel(
      Math.floor(Math.random() * 10) - 5,
      Math.floor(Math.random() * 10) + 90,
      Math.floor(Math.random() * 10) - 5,
      Math.floor(Math.random() * 5)
    );
  }, 500);
  const updates = [];
  const baseX = 10;
  const baseY = 150;
  const baseZ = 10;
  const radius = 5;
  for (let vx = -radius; vx <= radius; vx++) {
    for (let vy = -radius; vy <= radius; vy++) {
      for (let vz = -radius; vz <= radius; vz++) {
        if (vx ** 2 + vy ** 2 + vz ** 2 > radius ** 2) continue;
        const x = baseX + vx;
        const y = baseY + vy;
        const z = baseZ + vz;
        updates.push({ vx: x, vy: y, vz: z, voxel: 60 });
      }
    }
  }
  const chunk = 300;
  while (updates.length) {
    transport.send({
      type: "UPDATE",
      text: "flat",
      updates: updates.splice(0, chunk),
    });
  }
  let type = 60;
  setInterval(() => {
    type = type == 60 ? 0 : 60;
    transport.send({
      type: "UPDATE",
      text: "flat",
      updates: [
        {
          vx: 0,
          vy: 80,
          vz: 0,
          voxel: type,
        },
      ],
    });
  }, 500);
});

// transport.onInit = (payload) => {
//   const { entities } = payload;
//   if (entities && entities.length) {
//     entities.forEach((ent) => {
//       if (ent.type === "box") {
//         console.log(ent);
//       }
//     });
//   }
// };
