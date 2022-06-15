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
  ImageVoxelizer,
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

import LogoImage from "../assets/tree_transparent.svg";

import WaterImage from "../assets/own/water.png";
import LeavesImage from "../assets/own/leaves.png";
import GrassImage from "../assets/own/grass_top.png";
import GrassSideImage from "../assets/own/grass_side.png";
import DirtImage from "../assets/own/dirt.png";
import WoodTopImage from "../assets/own/wood_top.png";
import WoodSideImage from "../assets/own/wood_side.png";
import OrangeConcreteImage from "../assets/own/orange_concrete.png";
import BlueConcrete from "../assets/own/blue_concrete.png";
import RedConcreteImage from "../assets/own/red_concrete.png";
import WhiteConcreteImage from "../assets/own/white_concrete.png";
import YellowConcreteImage from "../assets/own/yellow_concrete.png";
import BlackConcreteImage from "../assets/own/black_concrete.png";
import IvoryBlockImage from "../assets/own/ivory_block.png";
import SandImage from "../assets/own/sand.png";
import StoneImage from "../assets/own/stone.png";
import SnowImage from "../assets/own/snow.png";

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
      fontSize: 0.2,
      yOffset: 0.3,
    });

    this.mesh.add(nameTag);
  }
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
  const [locked, setLocked] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
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
          { name: "Orange Concrete", side: "all", data: OrangeConcreteImage },
          { name: "Blue Concrete", side: "all", data: BlueConcrete },
          { name: "Red Concrete", side: "all", data: RedConcreteImage },
          { name: "White Concrete", side: "all", data: WhiteConcreteImage },
          { name: "Yellow Concrete", side: "all", data: YellowConcreteImage },
          { name: "Black Concrete", side: "all", data: BlackConcreteImage },
          { name: "Ivory Block", side: "all", data: IvoryBlockImage },
          { name: "Color", side: "all", data: new Color("#ffffff") },
          { name: "Grass", side: "top", data: GrassImage },
          { name: "Grass", side: "side", data: GrassSideImage },
          { name: "Grass", side: "bottom", data: DirtImage },
          { name: "Stone", side: "all", data: StoneImage },
          { name: "Leaves", side: "all", data: LeavesImage },
          { name: "Wood", side: "top", data: WoodTopImage },
          { name: "Wood", side: "side", data: WoodSideImage },
          { name: "Wood", side: "bottom", data: WoodTopImage },
          { name: "Sand", side: "all", data: SandImage },
          { name: "Snow", side: "all", data: SnowImage },
          { name: "Water", side: "all", data: WaterImage },
        ]);

        client.current.chat.addCommand(
          "image-voxelize",
          ImageVoxelizer.commander
        );

        client.current.ecs.addSystem(new UpdateBoxSystem());

        client.current?.connect({
          serverURL: BACKEND_SERVER,
          reconnectTimeout: 5000,
        });

        client.current.on("unlock", () => {
          setLocked(false);
        });

        client.current.on("lock", () => {
          setLocked(true);
        });

        client.current.on("chat-enabled", () => {
          setChatEnabled(true);
        });

        client.current.on("chat-disabled", () => {
          setChatEnabled(false);
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
      {!locked && !chatEnabled && (
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
