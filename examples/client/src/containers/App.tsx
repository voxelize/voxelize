import { useEffect, useRef } from "react";
import styled from "styled-components";
import * as VOXELIZE from "@voxelize/client";
import Stats from "stats.js";
import {
  EffectComposer,
  EffectPass,
  // PixelationEffect,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import * as THREE from "three";

import { setupWorld } from "src/core/world";
import { ColorText, Peers } from "@voxelize/client";
import { sRGBEncoding } from "three";

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

const Position = styled.p`
  position: absolute;
  bottom: 0;
  left: 0;
  margin: 8px;
  z-index: 100000;
  color: #eee;
`;

let BACKEND_SERVER_INSTANCE = new URL(window.location.href);

if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}

const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

const App = () => {
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<VOXELIZE.World | null>(null);
  const positionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!domRef.current || !canvasRef.current || !positionRef.current) return;
    if (worldRef.current) return;

    const clock = new THREE.Clock();
    const world = new VOXELIZE.World({
      textureDimension: 32,
    });
    const chat = new VOXELIZE.Chat();
    const inputs = new VOXELIZE.Inputs<"menu" | "in-game" | "chat">();

    inputs.setNamespace("menu");

    const sky = new VOXELIZE.Sky(2000);
    sky.box.paint("top", VOXELIZE.drawSun);
    world.add(sky);

    const clouds = new VOXELIZE.Clouds({
      uFogColor: sky.uMiddleColor,
    });
    // world.add(clouds);

    world.uniforms.fogColor.value.copy(sky.uMiddleColor.value);

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
    renderer.setPixelRatio(window.devicePixelRatio || 1);

    renderer.outputEncoding = sRGBEncoding;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(world, camera));
    composer.addPass(
      new EffectPass(
        camera,
        new SMAAEffect({})
        // new PixelationEffect(6)
      )
    );

    domRef.current.appendChild(renderer.domElement);

    const controls = new VOXELIZE.RigidControls(
      camera,
      renderer.domElement,
      world,
      {
        lookInGhostMode: true,
        initialPosition: [0, 12, 0],
      }
    );

    renderer.setTransparentSort(VOXELIZE.TRANSPARENT_SORT(controls.object));

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

    let hand = "Stone";
    let radius = 1;
    let circular = true;

    const bulkDestroy = () => {
      if (!controls.lookBlock) return;

      const [vx, vy, vz] = controls.lookBlock;

      const updates: VOXELIZE.BlockUpdate[] = [];

      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          for (let z = -radius; z <= radius; z++) {
            if (circular && x ** 2 + y ** 2 + z ** 2 > radius ** 2 - 1)
              continue;

            updates.push({
              vx: vx + x,
              vy: vy + y,
              vz: vz + z,
              type: 0,
            });
          }
        }
      }

      if (updates.length) controls.world.updateVoxels(updates);
    };

    const bulkPlace = () => {
      if (!controls.targetBlock) return;

      const {
        voxel: [vx, vy, vz],
        rotation,
      } = controls.targetBlock;

      const updates: VOXELIZE.BlockUpdate[] = [];
      const block = controls.world.getBlockByName(hand);

      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          for (let z = -radius; z <= radius; z++) {
            if (circular && x ** 2 + y ** 2 + z ** 2 > radius ** 2 - 1)
              continue;

            updates.push({
              vx: vx + x,
              vy: vy + y,
              vz: vz + z,
              type: block.id,
              rotation: rotation
                ? VOXELIZE.BlockRotation.encode(rotation, 0)
                : undefined,
            });
          }
        }
      }

      if (updates.length) controls.world.updateVoxels(updates);
    };

    inputs.click(
      "left",
      () => {
        bulkDestroy();
      },
      "in-game"
    );

    inputs.click(
      "middle",
      () => {
        if (!controls.lookBlock) return;
        const [vx, vy, vz] = controls.lookBlock;
        const block = controls.world.getBlockByVoxel(vx, vy, vz);
        hand = block.name;
      },
      "in-game"
    );

    inputs.click(
      "right",
      () => {
        bulkPlace();
      },
      "in-game"
    );

    inputs.scroll(
      () => (radius = Math.min(100, radius + 1)),
      () => (radius = Math.max(1, radius - 1)),
      "in-game"
    );

    inputs.bind(
      "b",
      () => {
        inputs.remap("t", "c", { occasion: "keyup" });
      },
      "in-game",
      { identifier: "BRUH" }
    );

    const peers = new Peers(controls.object);

    ColorText.SPLITTER = "$";

    inputs.bind(
      "o",
      () => {
        console.log(controls.object.position);
      },
      "in-game"
    );

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

    controls.useInputs(inputs, "in-game");

    const toggleFly = () => {
      if (!controls.ghostMode) {
        const isFlying = controls.body.gravityMultiplier === 0;

        if (!isFlying) {
          controls.body.applyImpulse([0, 8, 0]);
        }

        setTimeout(() => {
          controls.body.gravityMultiplier = isFlying ? 1 : 0;
        }, 100);
      }
    };
    inputs.bind("f", toggleFly, "in-game");

    const stats = new Stats();
    document.body.appendChild(stats.dom);
    stats.dom.style.margin = "8px";

    // Create a test for atlas
    // setTimeout(() => {
    //   const plane = new THREE.Mesh(
    //     new THREE.PlaneBufferGeometry(100, 100),
    //     world.atlas.material
    //   );
    //   world.add(plane);
    // }, 1000);

    network
      .register(chat)
      .register(world)
      .register(peers)
      .connect({ serverURL: BACKEND_SERVER, secret: "test" })
      .then(() => {
        network
          .join("world1")
          .then(() => {
            const animate = () => {
              requestAnimationFrame(animate);

              stats.begin();

              const delta = clock.getDelta();

              peers.update();
              controls.update(delta);

              clouds.update(camera.position, delta);
              sky.position.copy(camera.position);
              world.update(controls.object.position, delta);

              if (positionRef.current)
                positionRef.current.textContent = controls
                  .getPosition()
                  .toArray()
                  .map((x) => x.toFixed(2))
                  .toString();

              network.flush();

              composer.render();

              stats.end();
            };

            animate();
          })
          .catch((error) => {
            console.error("Connection error: " + error);
          });
      });

    worldRef.current = world;
  }, [domRef, canvasRef, worldRef, positionRef]);

  return (
    <GameWrapper ref={domRef}>
      <Position ref={positionRef} />
      <GameCanvas ref={canvasRef} />
    </GameWrapper>
  );
};

export default App;
