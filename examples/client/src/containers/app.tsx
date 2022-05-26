import { Button } from "@components/button";
import { Input } from "@components/input";
import {
  Client,
  BaseEntity,
  NameTag,
  Position3DComponent,
  TargetComponent,
  HeadingComponent,
  MetadataComponent,
  System,
  EntityFlag,
} from "@voxelize/client";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import {
  BoxBufferGeometry,
  MeshNormalMaterial,
  Mesh,
  Vector3,
  Color,
} from "three";

import WaterImage from "../assets/blocks/water.png";
import LeavesImage from '../assets/blocks/leaves_oak.png'
import GrassImage from '../assets/blocks/grass_top.png'
import DirtImage from '../assets/blocks/dirt.png'
import WoodTopImage from '../assets/blocks/log_oak_top.png'
import WoodSideImage from '../assets/blocks/log_oak_side.png'
import SandImage from '../assets/blocks/sand.png'
import StoneImage from '../assets/blocks/stone.png'

const GameWrapper = styled.div`
  background: black;
  position: absolute;
  width: 100vw;
  height: 100vh;
  top: 0;
  left: 0;
`;

const Crosshair = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  border: 2px solid #eee9;
  border-radius: 50%;
`;

const ControlsWrapper = styled.div`
  position: fixed;
  width: 100vw;
  height: 100vh;
  background: #00000022;

  & > div {
    padding: 32px 48px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 16px;
    position: absolute;
    top: 50%;
    left: 50%;
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

const BACKEND_SERVER = "http://localhost:4000/?world=";

class Box extends BaseEntity {
  public geometry: BoxBufferGeometry;
  public material: MeshNormalMaterial;

  constructor() {
    super();

    this.geometry = new BoxBufferGeometry(0.5, 0.5, 0.5);
    this.material = new MeshNormalMaterial();
    this.mesh = new Mesh(this.geometry, this.material);

    const nameTag = new NameTag("BOX", {
      backgroundColor: "#00000077",
      fontFace: "Syne Mono",
      fontSize: 0.2,
      yOffset: 0.3,
    });

    this.mesh.add(nameTag);
  }

  onCreation = (client: Client) => {
    client.rendering.scene.add(this.mesh);
  };

  onDeletion = (client: Client) => {
    client.rendering.scene.remove(this.mesh);
  };
}

class UpdateBoxSystem extends System {
  constructor() {
    super([
      EntityFlag.type,
      Position3DComponent.type,
      HeadingComponent.type,
      TargetComponent.type,
      MetadataComponent.type,
    ]);
  }

  update(entity: BaseEntity) {
    const { mesh } = entity;
    const metadata = MetadataComponent.get(entity).data;

    if (metadata.position) {
      entity.position.set(
        metadata.position[0],
        metadata.position[1],
        metadata.position[2]
      );
    }

    if (metadata.target) {
      entity.target.set(
        metadata.target[0],
        metadata.target[1],
        metadata.target[2]
      );
    }

    if (metadata.heading) {
      entity.target.set(
        metadata.target[0],
        metadata.target[1],
        metadata.target[2]
      );
    }

    mesh.position.lerp(
      entity.position.clone().add(new Vector3(0, 0, 0)),
      BaseEntity.LERP_FACTOR
    );
  }
}

export const App = () => {
  const [world, setWorld] = useState("world1");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [showControls, setShowControls] = useState(true);
  const client = useRef<Client | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (container.current) {
      if (!client.current) {
        client.current = new Client({
          container: {
            domElement: container.current,
          },
        });

        client.current.entities.registerEntity("Box", Box);

        client.current.registry.applyTexturesByNames([
          { name: "Dirt", side: "all", data: DirtImage },
          { name: "Lol", side: "all", data: new Color("#8479E1") },
          { name: "Marble", side: "all", data: new Color("#E9E5D6") },
          { name: "Color", side: "all", data: new Color("#ffffff") },
          { name: "Grass", side: "top", data: GrassImage },
          { name: "Grass", side: "side", data: GrassImage },
          { name: "Grass", side: "bottom", data: DirtImage },
          { name: "Stone", side: "all", data: StoneImage },
          { name: "Leaves", side: "all", data: LeavesImage },
          { name: "Wood", side: "top", data: WoodTopImage },
          { name: "Wood", side: "side", data: WoodSideImage },
          { name: "Wood", side: "bottom", data: WoodTopImage },
          { name: "Sand", side: "all", data: SandImage },
          { name: "Snow", side: "all", data: new Color("#FFFFFF") },
          { name: "Water", side: "all", data: WaterImage },
        ]);

        client.current.ecs.addSystem(new UpdateBoxSystem());

        client.current?.connect({
          serverURL: BACKEND_SERVER,
          reconnectTimeout: 5000,
        });

        client.current.on("unlock", () => {
          setShowControls(true);
        });

        client.current.on("lock", () => {
          setShowControls(false);
        });

        client.current.on("join", () => {
          setJoined(true);
        });

        client.current.on("leave", () => {
          setJoined(false);
        });

        setName(client.current.name);
      }

      joinOrResume(false);
    }
  }, []);

  useEffect(() => {
    if (client.current) {
      client.current.setName(name);
    }
  }, [name]);

  const joinOrResume = (lock = true) => {
    if (!client.current) return;

    if (joined) {
      if (lock) {
        client.current.controls.lock();
      }
      return;
    }

    const joinWorld = (success: boolean) => {
      client.current?.join(world);

      if (success) {
        if (lock) {
          client.current?.controls.lock();
        }
      } else {
        setError("World not found.");
      }
    };

    if (!client.current.connectionPromise) {
      joinWorld(true);
    } else {
      client.current.connectionPromise.then((success) => {
        joinWorld(success);
      });
    }
  };

  const leave = () => {
    if (!client.current) return;
    client.current.leave();
  };

  return (
    <GameWrapper ref={container}>
      <Crosshair />
      {showControls && (
        <ControlsWrapper>
          <div>
            <img
              src="https://cdn-icons-png.flaticon.com/512/226/226904.png"
              alt="logo"
            />
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
