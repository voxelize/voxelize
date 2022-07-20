import { Button } from "../components/button";
import { Input } from "../components/input";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import * as VOXELIZE from "@voxelize/client";

import LogoImage from "../assets/tree_transparent.svg";

import { setupWorld } from "src/core/world";

const GameWrapper = styled.div`
  background: black;
  position: absolute;
  width: 100vw;
  height: 100vh;
  top: 0;
  left: 0;
`;

const ControlsWrapper = styled.div`
  position: fixed;
  width: 100vw;
  height: 100vh;
  background: #00000022;
  z-index: 100000;

  & > div {
    backdrop-filter: blur(2px);
    padding: 32px 48px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 16px;
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 1000;
    transform: translate(-50%, -50%);
    background: #fff2f911;
    border-radius: 4px;
  }

  & img {
    width: 60px;
  }

  & h3 {
    color: #eee;
    margin-bottom: 12px;
  }

  & .error {
    font-size: 0.8rem;
    color: red;
  }
`;

let BACKEND_SERVER_INSTANCE = new URL(window.location.href);

if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}

const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

const App = () => {
  const [world, setWorld] = useState("world3");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);

  const domRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<VOXELIZE.Network | null>(null);
  const controlsRef = useRef<VOXELIZE.RigidControls | null>(null);

  useEffect(() => {
    if (domRef.current && !networkRef.current && !controlsRef.current) {
      const clock = new VOXELIZE.Clock();
      const loader = new VOXELIZE.Loader();
      const world = new VOXELIZE.World(loader, { textureDimension: 128 });
      const container = new VOXELIZE.Container({
        domElement: domRef.current,
      });
      const camera = new VOXELIZE.Camera({
        aspectRatio: container.aspectRatio,
      });
      const controls = new VOXELIZE.RigidControls(camera, world, container);
      const rendering = new VOXELIZE.Rendering(container);

      world.physics.bodies.push(controls.body);

      const network = new VOXELIZE.Network();

      if (!networkRef.current) {
        networkRef.current = network;
      }

      if (!controlsRef.current) {
        controlsRef.current = controls;
      }

      controls.on("unlock", () => {
        setLocked(false);
      });

      controls.on("lock", () => {
        setLocked(true);
      });

      network.on("join", () => {
        setJoined(true);
      });

      network.on("leave", () => {
        setJoined(false);
      });

      setupWorld(world);

      window.addEventListener("resize", () => {
        const { aspectRatio } = container;
        rendering.adjustRenderer();
        camera.aspect = aspectRatio;
        camera.updateProjectionMatrix();
      });

      loader.load().then(() => {
        network
          .cover(world)
          .connect({ serverURL: BACKEND_SERVER, secret: "test" })
          .then((network) => {
            network.join("world3").then(() => {
              setName(network.clientInfo.username);

              const animate = () => {
                requestAnimationFrame(animate);

                const center = controls.position;
                const { x, z } = controls.getDirection();

                camera.update();
                controls.update(clock.delta);
                world.update(center, clock.delta, [x, z]);

                network.flush();

                clock.update();

                rendering.render(world, camera);
              };

              // joinOrResume(false);
              animate();
            });
          });
      });
    }
  }, [domRef]);

  const joinOrResume = (lock = true) => {
    if (!networkRef.current || !controlsRef.current) return;

    if (joined) {
      if (lock) {
        controlsRef.current.lock();
      }
      return;
    }

    if (!networkRef.current.joined) {
      networkRef.current?.join(world);
    }
  };

  const leave = () => {
    if (!networkRef.current) return;
    networkRef.current.leave();
  };

  return (
    <GameWrapper ref={domRef}>
      {!locked && (
        <ControlsWrapper>
          <div>
            <img src={LogoImage} alt="logo" />
            <h3>Voxelize Demo!</h3>
            <Input
              label="world"
              value={world}
              onChange={(e) => {
                setWorld(e.target.value);
                setError("");
              }}
              disabled={joined}
            />
            {joined && (
              <Input
                label="name"
                onChange={(e) => setName(e.target.value)}
                maxLength={16}
                value={name}
              />
            )}
            <Button onClick={() => joinOrResume()}>
              {joined ? "resume" : "join"}
            </Button>
            {joined && <Button onClick={leave}>leave</Button>}
            <span className="error">{error}</span>
          </div>
        </ControlsWrapper>
      )}
    </GameWrapper>
  );
};

export default App;
