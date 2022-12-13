import { useEffect, useRef } from "react";
import styled from "styled-components";
import * as VOXELIZE from "@voxelize/client";
import * as BABYLON from "@babylonjs/core/Legacy/legacy";

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

const App = () => {
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!domRef.current || !canvasRef.current) return;

    const network = new VOXELIZE.Network();
    const canvas = canvasRef.current;

    const engine = new BABYLON.Engine(canvas, true);

    const scene = new BABYLON.Scene(engine);

    const camera = new BABYLON.ArcRotateCamera(
      "Camera",
      Math.PI / 2,
      Math.PI / 2,
      10,
      BABYLON.Vector3.Zero(),
      scene
    );

    camera.attachControl(canvas, true);

    let config: VOXELIZE.WorldServerParams;

    const light = new BABYLON.DirectionalLight(
      "dir01",
      new BABYLON.Vector3(0, -1, 0.5),
      scene
    );
    light.intensity = 0.7;

    const shadowGenerator = new BABYLON.ShadowGenerator(1024, light);
    shadowGenerator.setDarkness(0.5);
    shadowGenerator.usePoissonSampling = true;
    // shadowGenerator.bias = 0;

    network.register({
      onMessage(message) {
        switch (message.type) {
          case "INIT": {
            const { json } = message;
            config = json.params;
            break;
          }
          case "LOAD": {
            const { chunks } = message;
            const { chunkSize, maxHeight, subChunks } = config;
            const subChunkHeight = maxHeight / subChunks;
            chunks?.forEach((chunk) => {
              const { meshes, x, z } = chunk;

              meshes.forEach((data) => {
                const { opaque, level } = data;
                opaque.forEach((subMesh) => {
                  const { indices, positions } = subMesh;
                  const vertexData = new BABYLON.VertexData();

                  const normals = [];

                  //Calculations of normals added
                  BABYLON.VertexData.ComputeNormals(
                    positions,
                    indices,
                    normals
                  );

                  vertexData.positions = positions;
                  vertexData.indices = indices;
                  vertexData.normals = normals;

                  const mesh = new BABYLON.Mesh("mesh", scene);
                  mesh.material = new BABYLON.StandardMaterial(
                    "material",
                    scene
                  );
                  mesh.receiveShadows = true;

                  shadowGenerator.getShadowMap()?.renderList?.push(mesh);

                  vertexData.applyToMesh(mesh, true);
                  mesh.setAbsolutePosition(
                    new BABYLON.Vector3(
                      x * chunkSize,
                      subChunkHeight * level,
                      z * chunkSize
                    )
                  );
                });
              });
            });
            break;
          }
          default: {
            break;
          }
        }
      },
    });

    const start = async () => {
      await network.connect(BACKEND_SERVER, { secret: "test" });
      await network.join("world1");

      const chunks: [number, number][] = [];

      const radius = 3;
      for (let x = -radius; x < radius; x++) {
        for (let z = -radius; z < radius; z++) {
          chunks.push([x, z]);
        }
      }

      network.send({
        type: "LOAD",
        json: {
          chunks,
        },
      });

      engine.runRenderLoop(() => {
        scene.render();
      });
    };

    window.addEventListener("resize", () => {
      engine.resize();
    });

    start();
  }, [domRef, canvasRef]);

  return (
    <GameWrapper ref={domRef}>
      {/* <Crosshair /> */}
      <GameCanvas ref={canvasRef} />
    </GameWrapper>
  );
};

export default App;
