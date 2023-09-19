import { AtlasTexture } from "@voxelize/core";
import { NetIntercept, Network } from "@voxelize/network";
import { Message } from "@voxelize/protocol";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Cat404Image from "./assets/404.png";
import "./style.css";

const packetTest = document.getElementById("packet-test") as HTMLButtonElement;
packetTest.addEventListener("click", () => {
  network.sendPackets([
    {
      type: "INIT",
      json: { name: "test", email: "test@gmail.com", number: 42 },
      chunks: [
        {
          x: 0,
          z: 0,
          id: "test",
          blocks: new Uint32Array(16 * 16 * 16).fill(
            0x000000ff | (0x0000ff00 << 8) | (0x00ff0000 << 16),
          ),
          lights: new Uint32Array(16 * 16 * 16),
          meshes: [],
          metainfo: {},
        },
      ],
    },
  ]);
});

const chunkingTest = document.getElementById(
  "chunking-test",
) as HTMLButtonElement;
chunkingTest.addEventListener("click", () => {
  network.sendPackets([
    {
      type: "CHUNK",
      json: {
        chunks: [[0, 0]],
      },
    },
  ]);
});

class World implements NetIntercept {
  onMessages(messages: Message[]) {
    for (const message of messages) {
      for (const packet of message.packets) {
        switch (packet.type) {
          case "INIT":
            const { atlas, name } = packet.json;

            const textureAtlasMap = AtlasTexture.fromJSON(atlas);

            let i = 0;

            for (const textureAtlas of textureAtlasMap.values()) {
              const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 1),
                new THREE.MeshBasicMaterial({
                  map: textureAtlas,
                  transparent: true,
                  side: THREE.DoubleSide,
                }),
              );

              scene.add(plane);

              plane.position.x = i * 1.1;

              i++;
            }

            const image = new Image();
            image.src = Cat404Image;
            image.onload = () => {
              console.log(image);
              textureAtlasMap.get("dirt")?.drawImageToFace("px", image);
            };

            console.log(textureAtlasMap);

            console.log(atlas);
            break;

          case "CHUNK": {
            const { chunks } = packet;
            console.log(chunks);

            if (!chunks) break;

            for (const chunk of chunks) {
              const { meshes } = chunk;

              meshes.forEach((mesh) => {
                console.log(mesh);
              });
            }

            break;
          }

          default: {
            console.log(packet);
          }
        }
      }
    }
  }
}

const world = new World();

const network = new Network();

network.register(world);

// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

// Renderer
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

camera.position.z = 1;
camera.lookAt(0, 0, 0);

// Orbit controls
const controls = new OrbitControls(camera, renderer.domElement);

// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});

// On load
window.addEventListener("load", async () => {
  console.log("loaded!");

  const worlds = await fetch("http://localhost:8080/worlds").then((res) =>
    res.json(),
  );

  network.sendPackets([
    {
      type: "JOIN",
      text: worlds[0].id,
    },
  ]);
});

function animate() {
  requestAnimationFrame(animate);

  renderer.render(scene, camera);
}

async function start() {
  await network.connect();
  console.log("connected!");

  animate();
}

start();
