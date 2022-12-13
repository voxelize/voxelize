import { useEffect, useRef } from "react";
import styled from "styled-components";
import * as VOXELIZE from "@voxelize/client";
import * as THREE from "three";
import { MeshRenderer } from "three-nebula";
import { AABB } from "@voxelize/aabb";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { WboitPass, sRGBShader } from "three-wboit";

import { setupWorld } from "../core";
import { ColorText, Peers } from "@voxelize/client";
import { sRGBEncoding } from "three";
import LolImage from "../assets/lol.png";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";

const GameWrapper = styled.div`
  background: black;
  position: absolute;
  width: 100vw;
  height: 100vh;
  top: 0;
  left: 0;
  overflow: hidden;
`;

const GameCanvas = styled.canvas`
  position: absolute;
  width: 100%;
  height: 100%;
`;

const Crosshair = styled.div`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 6px;
  border: 2px solid #eeeeee55;
  z-index: 100000;

  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 4px;
    height: 4px;
    background: #eeeeee55;
  }
`;

let BACKEND_SERVER_INSTANCE = new URL(window.location.href);

if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}

const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

class Box extends VOXELIZE.Entity<{
  position: VOXELIZE.Coords3;
}> {
  constructor(id: string) {
    super(id);

    this.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshNormalMaterial()
      )
    );
  }

  onSpawn = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.set(...data.position);
  };

  onUpdate = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.lerp(new THREE.Vector3(...data.position), 0.8);
  };
}

const App = () => {
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<VOXELIZE.World | null>(null);

  useEffect(() => {
    if (!domRef.current || !canvasRef.current) return;
    if (worldRef.current) return;

    const world = new VOXELIZE.World({
      textureDimension: 16,
      defaultRenderRadius: 5,
      maxUpdatesPerTick: 10000,
    });
    const chat = new VOXELIZE.Chat();
    const inputs = new VOXELIZE.Inputs<"menu" | "in-game" | "chat">();

    const character = new VOXELIZE.Character({
      // head: {
      //   height: 0.5,
      //   heightSegments: 64,
      //   widthSegments: 64,
      // },
    });
    character.position.set(0, 10, -5);

    world.loader.addTexture(LolImage, (texture) => {
      character.head.paint("front", texture);
    });

    world.overwriteBlockDynamicByName("Water", (pos) => {
      let [vx, vy, vz] = pos;

      let topIsWater = false;

      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          if (world.getBlockByVoxel(vx + ox, vy + 1, vz + oz)?.name === "Water")
            topIsWater = true;
        }
      }

      const originalAABB = world.registry.getBlockByName("Water");

      return {
        ...originalAABB,
        aabbs: topIsWater ? [new AABB(0, 0, 0, 1, 1, 1)] : originalAABB.aabbs,
      };
    });

    inputs.on("namespace", (namespace) => {
      console.log("namespace changed", namespace);
    });
    inputs.setNamespace("menu");

    const sky = new VOXELIZE.Sky(2000);
    sky.paint("top", VOXELIZE.artFunctions.drawSun);
    world.add(sky);

    const clouds = new VOXELIZE.Clouds({
      uFogColor: sky.uMiddleColor,
    });

    world.add(clouds);
    world.setFogColor(sky.getMiddleColor());

    const camera = new THREE.PerspectiveCamera(
      90,
      domRef.current.offsetWidth / domRef.current.offsetHeight,
      0.1,
      5000
    );

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
    });
    renderer.setSize(
      renderer.domElement.offsetWidth,
      renderer.domElement.offsetHeight
    );
    renderer.setPixelRatio(1);

    renderer.outputEncoding = sRGBEncoding;

    const composer = new EffectComposer(renderer);
    composer.addPass(new WboitPass(renderer, world, camera));
    composer.addPass(new ShaderPass(sRGBShader));
    // composer.addPass(new RenderPass(world, camera));

    // const overlayEffect = new VOXELIZE.BlockOverlayEffect(world, camera);
    // overlayEffect.addOverlay("water", new THREE.Color("#5F9DF7"), 0.05);

    const lightShined = new VOXELIZE.LightShined(world);
    lightShined.add(character);

    domRef.current.appendChild(renderer.domElement);

    const controls = new VOXELIZE.RigidControls(
      camera,
      renderer.domElement,
      world,
      {
        initialPosition: [0, 12, 0],
      }
    );

    controls.attachCharacter(character);
    controls.connect(inputs, "in-game");

    world.addChunkInitListener([0, 0], controls.teleportToTop);

    renderer.setTransparentSort(VOXELIZE.TRANSPARENT_SORT(controls.object));

    const perspective = new VOXELIZE.Perspective(controls, world);
    perspective.connect(inputs, "in-game");

    const network = new VOXELIZE.Network();

    setupWorld(world);

    window.addEventListener("resize", () => {
      const width = domRef.current?.offsetWidth as number;
      const height = domRef.current?.offsetHeight as number;

      renderer.setSize(width, height);

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });

    controls.on("lock", () => {
      inputs.setNamespace("in-game");
    });

    controls.on("unlock", () => {
      inputs.setNamespace("menu");
    });

    const voxelInteract = new VOXELIZE.VoxelInteract(controls.object, world, {
      highlightType: "outline",
      // potentialVisuals: true,
      inverseDirection: true,
      // ignoreFluids: false,
    });
    world.add(voxelInteract);

    const debug = new VOXELIZE.Debug(document.body);

    inputs.bind(
      "t",
      () => {
        controls.unlock(() => {
          inputs.setNamespace("chat");
        });
      },
      "in-game"
    );

    inputs.bind(
      "Escape",
      () => {
        controls.lock();
      },
      "chat",
      {
        // Need this so that ESC doesn't unlock the pointerlock.
        occasion: "keyup",
      }
    );

    // let hand = "glass";
    // let radius = 1;
    // let circular = true;

    // const bulkDestroy = () => {
    //   if (!voxelInteract.target) return;

    //   const [vx, vy, vz] = voxelInteract.target;

    //   const updates: VOXELIZE.BlockUpdate[] = [];

    //   for (let x = -radius; x <= radius; x++) {
    //     for (let y = -radius; y <= radius; y++) {
    //       for (let z = -radius; z <= radius; z++) {
    //         if (circular && x ** 2 + y ** 2 + z ** 2 > radius ** 2 - 1)
    //           continue;

    //         updates.push({
    //           vx: vx + x,
    //           vy: vy + y,
    //           vz: vz + z,
    //           type: 0,
    //         });
    //       }
    //     }
    //   }

    //   if (updates.length) controls.world.updateVoxels(updates);
    // };

    // const bulkPlace = () => {
    //   if (!voxelInteract.potential) return;

    //   const {
    //     voxel: [vx, vy, vz],
    //     rotation,
    //     yRotation,
    //   } = voxelInteract.potential;

    //   const updates: VOXELIZE.BlockUpdate[] = [];
    //   const block = controls.world.getBlockByName(hand);

    //   for (let x = -radius; x <= radius; x++) {
    //     for (let y = -radius; y <= radius; y++) {
    //       for (let z = -radius; z <= radius; z++) {
    //         if (circular && x ** 2 + y ** 2 + z ** 2 > radius ** 2 - 1)
    //           continue;

    //         updates.push({
    //           vx: vx + x,
    //           vy: vy + y,
    //           vz: vz + z,
    //           type: block.id,
    //           rotation,
    //           yRotation,
    //         });
    //       }
    //     }
    //   }

    //   if (updates.length) controls.world.updateVoxels(updates);
    // };

    const particleRenderer = new MeshRenderer(world, THREE);
    const blockBreakParticles = new VOXELIZE.BlockBreakParticles(world);
    blockBreakParticles.addRenderer(particleRenderer);

    // inputs.scroll(
    //   () => (radius = Math.min(100, radius + 1)),
    //   () => (radius = Math.max(1, radius - 1)),
    //   "in-game"
    // );

    // inputs.bind(
    //   "b",
    //   () => {
    //     inputs.remap("t", "c", { occasion: "keyup" });
    //   },
    //   "in-game",
    //   { identifier: "BRUH" }
    // );

    const peers = new Peers<VOXELIZE.Character>(controls.object);

    peers.createPeer = () => {
      const peer = new VOXELIZE.Character({
        // head: {
        //   height: 0.5,
        //   heightSegments: 64,
        //   widthSegments: 64,
        // },
      });
      peer.head.paint("front", world.loader.getTexture(LolImage));
      lightShined.add(peer);
      shadows.add(peer);
      return peer;
    };

    peers.setOwnPeer(character);

    peers.onPeerUpdate = (object, data, info) => {
      object.set(data.position, data.direction);
      object.username = info.username;
    };

    world.add(peers);

    ColorText.SPLITTER = "$";

    // inputs.bind(
    //   "o",
    //   () => {
    //     console.log(controls.object.position);
    //   },
    //   "in-game"
    // );

    inputs.bind(
      "g",
      () => {
        controls.toggleGhostMode();
      },
      "in-game"
    );

    inputs.bind(
      "enter",
      () => {
        controls.lock();
      },
      "chat"
    );

    inputs.bind("f", controls.toggleFly, "in-game");

    inputs.bind("j", debug.toggle, "*");

    // inputs.bind("l", () => {
    //   network.action("create_world", "new_world");
    // });

    debug.registerDisplay("Position", controls, "voxel");

    debug.registerDisplay("Sunlight", () => {
      return world.getSunlightByVoxel(...controls.voxel);
    });

    debug.registerDisplay(
      "Chunks to Request",
      world.chunks.toRequest,
      "length"
    );
    debug.registerDisplay("Chunks Requested", world.chunks.requested, "size");
    debug.registerDisplay(
      "Chunks to Process",
      world.chunks.toProcess,
      "length"
    );
    debug.registerDisplay("Chunks to Add", world.chunks.toAdd, "length");

    ["Red", "Green", "Blue"].forEach((color) => {
      debug.registerDisplay(color + " Light", () => {
        return world.getTorchLightByVoxel(
          ...controls.voxel,
          color.toUpperCase() as any
        );
      });
    });

    inputs.bind("p", () => {
      voxelInteract.toggle();
    });

    const entities = new VOXELIZE.Entities();

    entities.setClass("box", Box);

    world.add(entities);

    const method = new VOXELIZE.Method();

    inputs.bind("m", () => {
      method.call("test", {
        test: "Hello World",
      });
    });

    inputs.bind("z", () => {
      method.call("spawn", {
        position: controls.object.position.toArray(),
      });
    });

    const events = new VOXELIZE.Events();

    events.on("test2", (payload) => {
      console.log("test2 event:", payload);
    });

    events.on("test1", (payload) => {
      console.log("test1 event:", payload);
    });

    inputs.bind("n", () => {
      events.emit("test2", {
        test: "Hello World",
      });
    });

    inputs.bind("b", () => {
      events.emitMany([
        {
          name: "test1",
          payload: {
            test: "Hello World",
          },
        },
        {
          name: "test2",
          payload: {
            test: "Hello World",
          },
        },
      ]);
    });

    const shadows = new VOXELIZE.Shadows(world);
    shadows.add(character);

    // Create a test for atlas
    // setTimeout(() => {
    //   const plane = new THREE.Mesh(
    //     new THREE.PlaneBufferGeometry(100, 100),
    //     world.atlas.material
    //   );
    //   world.add(plane);
    // }, 1000);

    // const portraits = new VOXELIZE.BlockPortraits(world);

    // for (let i = 0; i < 5; i++) {
    //   const canvas = portraits.add("fuck" + i, 2);
    //   VOXELIZE.DOMUtils.applyStyles(canvas, {
    //     position: "fixed",
    //     top: `${Math.floor(i / 10) * 100}px`,
    //     right: `${(i % 10) * 100}px`,
    //     zIndex: "10000000000000000",
    //     background: "black",
    //   });
    //   document.body.appendChild(canvas);
    // }

    world.overwriteMaterialByIdentifier(
      "Grass",
      true,
      VOXELIZE.customShaders.sway({
        rooted: true,
      })
    );

    world.overwriteMaterialByIdentifier(
      "Oak Leaves",
      true,
      VOXELIZE.customShaders.sway({
        yScale: 0,
      })
    );

    world.applyResolutionByName("Grass Block", "py", 512);

    network
      .register(chat)
      .register(entities)
      .register(world)
      .register(method)
      .register(events)
      .register(peers)
      .register(blockBreakParticles);

    const HOTBAR_CONTENT = [1, 5, 20, 40, 43, 45, 300, 400, 500];

    const start = async () => {
      const animate = () => {
        requestAnimationFrame(animate);

        if (world.initialized) {
          peers.update();
          controls.update();

          clouds.update(controls.object.position);
          sky.update(controls.object.position);
          world.update(controls.object.position);

          network.flush();

          perspective.update();
          shadows.update();
          debug.update();
          blockBreakParticles.update();
          lightShined.update();
          voxelInteract.update();
        }

        composer.render();
      };

      animate();

      await network.connect(BACKEND_SERVER, { secret: "test" });
      await network.join("world1");
      await world.init();

      const bar = new VOXELIZE.ItemSlots({
        // verticalCount: 5,
        horizontalCount: HOTBAR_CONTENT.length,
      });
      document.body.appendChild(bar.element);

      HOTBAR_CONTENT.forEach((id, index) => {
        const mesh = world.makeBlockMesh(id, { material: "standard" });
        const slot = bar.getSlot(0, index);
        slot.setObject(mesh);

        if (id === 500) {
          slot.setPerspective("pz");
        }

        slot.setContent(id);
      });

      ["1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach((key) => {
        inputs.bind(
          key,
          () => {
            const index = parseInt(key);
            bar.setFocused(0, index - 1);
          },
          "in-game"
        );
      });

      inputs.click(
        "left",
        () => {
          const { target } = voxelInteract;
          if (!target) return;
          world.updateVoxel(...target, 0);
        },
        "in-game"
      );

      inputs.click(
        "middle",
        () => {
          if (!voxelInteract.target) return;
          const [vx, vy, vz] = voxelInteract.target;
          const block = controls.world.getBlockByVoxel(vx, vy, vz);
          const slot = bar.getFocused();
          slot.setObject(
            world.makeBlockMesh(block.id, { material: "standard" })
          );
          slot.setContent(block.id);
        },
        "in-game"
      );

      inputs.click(
        "right",
        () => {
          if (!voxelInteract.potential) return;
          const {
            rotation,
            yRotation,
            voxel: [vx, vy, vz],
          } = voxelInteract.potential;
          const slot = bar.getFocused();
          const id = slot.content;
          if (!id) return;
          world.updateVoxel(vx, vy, vz, id, rotation, yRotation);
        },
        "in-game"
      );

      bar.connect(inputs);
    };

    start();

    worldRef.current = world;
  }, [domRef, canvasRef, worldRef]);

  return (
    <GameWrapper ref={domRef}>
      <Crosshair />
      <GameCanvas ref={canvasRef} />
    </GameWrapper>
  );
};

export default App;
