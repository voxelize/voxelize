import { useEffect, useRef } from "react";
import styled from "styled-components";
import * as VOXELIZE from "@voxelize/client";
import * as THREE from "three";

import { setupWorld } from "src/core/world";

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

  useEffect(() => {
    if (domRef.current && canvasRef.current) {
      const clock = new VOXELIZE.Clock();
      const world = new VOXELIZE.World({ textureDimension: 128 });

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
      domRef.current.appendChild(renderer.domElement);

      const controls = new VOXELIZE.RigidControls(
        camera,
        renderer.domElement,
        world
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

      network
        .cover(world)
        .connect({ serverURL: BACKEND_SERVER, secret: "test" })
        .then(() => {
          network.join("world3").then(() => {
            const animate = () => {
              requestAnimationFrame(animate);

              controls.update(clock.delta);

              world.update(
                camera.position,
                clock.delta,
                controls.getDirection()
              );

              network.flush();

              clock.update();

              renderer.render(world, camera);
            };

            animate();
          });
        });
    }
  }, [domRef, canvasRef]);

  return (
    <GameWrapper ref={domRef}>
      <GameCanvas ref={canvasRef} />
    </GameWrapper>
  );
};

export default App;
