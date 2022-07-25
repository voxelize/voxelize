import { useEffect, useRef } from "react";
import styled from "styled-components";
import * as VOXELIZE from "@voxelize/client";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import * as THREE from "three";

import { setupWorld } from "src/core/world";
import {
  ChunkUtils,
  ColorText,
  NameTag,
  Peers,
  SpriteText,
} from "@voxelize/client";
import { sRGBEncoding } from "three";
import TestImage from "../assets/cat.jpeg";

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

let BACKEND_SERVER_INSTANCE = new URL(window.location.href);

if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}

const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

const App = () => {
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<VOXELIZE.World | null>(null);

  useEffect(() => {
    if (domRef.current && canvasRef.current && !worldRef.current) {
      const clock = new THREE.Clock();
      const world = new VOXELIZE.World({
        textureDimension: 128,
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

      renderer.outputEncoding = sRGBEncoding;

      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(world, camera));
      composer.addPass(new EffectPass(camera, new SMAAEffect({})));

      domRef.current.appendChild(renderer.domElement);

      const controls = new VOXELIZE.RigidControls(
        camera,
        renderer.domElement,
        world,
        {
          lookInGhostMode: true,
          initialPosition: [0, 20, 0],
        }
      );

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
        "esc",
        () => {
          controls.lock();
        },
        "chat",
        {
          // Need this so that ESC doesn't unlock the pointerlock.
          occasion: "keyup",
        }
      );

      inputs.click(
        "left",
        () => {
          if (!controls.lookBlock) return;
          const [vx, vy, vz] = controls.lookBlock;
          world.updateVoxel(vx, vy, vz, 0);
        },
        "in-game"
      );

      let hand = "Stone";

      inputs.click(
        "middle",
        () => {
          if (!controls.lookBlock) return;
          const [vx, vy, vz] = controls.lookBlock;
          hand = world.getBlockByVoxel(vx, vy, vz).name;
        },
        "in-game"
      );

      inputs.click(
        "right",
        () => {
          if (!controls.targetBlock) return;
          const { rotation, voxel, yRotation } = controls.targetBlock;
          const id = world.getBlockByName(hand).id;
          world.updateVoxel(
            ...voxel,
            id,
            rotation
              ? VOXELIZE.BlockRotation.encode(rotation, yRotation)
              : undefined
          );
        },
        "in-game"
      );

      const peers = new Peers(controls.object);

      peers.onPeerUpdate = (peer) => {
        console.log(peer);
      };

      ColorText.SPLITTER = "$";

      const nametag = new NameTag(
        "$#E6B325$[VIP] $white$LMAO\n$cyan$[MVP] $white$BRUH",
        { fontSize: 0.5 }
      );
      nametag.position.set(0, 75, 0);
      world.add(nametag);

      inputs.bind(
        "p",
        () => {
          nametag.text = "∆#E6B325∆[VIP] ∆white∆HAHA\n∆cyan∆[MVP] ∆white∆BRUH";
        },
        "in-game"
      );

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

      let lastSpace = -1;
      inputs.bind(
        "space",
        () => {
          let now = performance.now();
          if (now - lastSpace < 250) {
            toggleFly();
            now = 0;
          }
          lastSpace = now;
        },
        "in-game",
        { occasion: "keyup" }
      );

      network
        .register(chat)
        .register(world)
        .register(peers)
        .connect({ serverURL: BACKEND_SERVER, secret: "test" })
        .then(() => {
          network.join("world2").then(() => {
            const animate = () => {
              requestAnimationFrame(animate);

              const delta = clock.getDelta();

              peers.update();
              controls.update(delta);

              clouds.update(camera.position, delta);
              sky.position.copy(camera.position);

              world.update(
                controls.object.position,
                delta,
                controls.getDirection()
              );

              network.flush();

              composer.render();
            };

            animate();
          });
        });

      worldRef.current = world;
    }
  }, [domRef, canvasRef]);

  return (
    <GameWrapper ref={domRef}>
      <GameCanvas ref={canvasRef} />
    </GameWrapper>
  );
};

export default App;
