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
  BlockUpdate,
  Trigger,
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
import ObsidianImage from "../assets/own/obsidian.png";
import OakLeavesImage from "../assets/own/oak_leaves.png";
import GrassImage from "../assets/own/grass_top.png";
import GrassSideImage from "../assets/own/grass_side.png";
import DirtImage from "../assets/own/dirt.png";
import OakTopImage from "../assets/own/oak_log_top.png";
import OakSideImage from "../assets/own/oak_log_side.png";
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
import Color2Image from "../assets/own/color2.png";
import BirchTopImage from "../assets/own/birch_log_top.png";
import BirchSideImage from "../assets/own/birch_log_side.png";
import GraniteImage from "../assets/own/granite.png";
import GraphiteImage from "../assets/own/graphite.png";
import MarbleImage from "../assets/own/marble.png";
import SlateImage from "../assets/own/slate.png";
import AndesiteImage from "../assets/own/andesite.png";
import OakPlanksImage from "../assets/own/oak_planks.png";
import LolImage from "../assets/lol.jpeg";
import ChoGeImage from "../assets/lol.png";

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
  public static geometry: BoxBufferGeometry;
  public static material: MeshNormalMaterial;

  constructor() {
    super();

    if (!Box.geometry) {
      Box.geometry = new BoxBufferGeometry(0.5, 0.5, 0.5);
      Box.material = new MeshNormalMaterial();
    }

    this.mesh = new Mesh(Box.geometry, Box.material);

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
  const [world, setWorld] = useState("world3");
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
        client.current = new Client(
          {
            container: {
              domElement: container.current,
            },
            debug: {
              onByDefault: true,
            },
            registry: {
              dimension: 64,
            },
          },
          {
            canChat: true,
            canDebug: true,
            canFly: true,
            canGhost: true,
            canUpdate: true,
            commands: "*",
          }
        );

        client.current.entities.registerEntity("Box", Box);

        const all = ["px", "nx", "py", "ny", "pz", "nz"];
        const side = ["px", "nx", "pz", "nz"];

        client.current.registry.applyTexturesByNames([
          { name: "Dirt", sides: all, data: DirtImage },
          { name: "Lol", sides: all, data: new Color("#8479E1") },
          { name: "Lol", sides: ["py"], data: LolImage },
          { name: "Marble", sides: all, data: MarbleImage },
          { name: "Orange Concrete", sides: all, data: OrangeConcreteImage },
          { name: "Blue Concrete", sides: all, data: BlueConcrete },
          { name: "Red Concrete", sides: all, data: RedConcreteImage },
          { name: "White Concrete", sides: all, data: WhiteConcreteImage },
          { name: "Yellow Concrete", sides: all, data: YellowConcreteImage },
          { name: "Black Concrete", sides: all, data: BlackConcreteImage },
          { name: "Ivory Block", sides: all, data: IvoryBlockImage },
          { name: "Grass", sides: ["py"], data: GrassImage },
          { name: "Color", sides: all, data: new Color("#ffffff") },
          { name: "Color", sides: all, data: Color2Image },
          { name: "Grass", sides: side, data: GrassSideImage },
          { name: "Grass", sides: ["ny"], data: DirtImage },
          { name: "Stone", sides: all, data: StoneImage },
          { name: "Oak Leaves", sides: all, data: OakLeavesImage },
          { name: "Oak Log", sides: ["py"], data: OakTopImage },
          { name: "Oak Log", sides: side, data: OakSideImage },
          { name: "Oak Log", sides: ["ny"], data: OakTopImage },
          { name: "Birch Log", sides: ["py"], data: BirchTopImage },
          { name: "Birch Log", sides: side, data: BirchSideImage },
          { name: "Birch Log", sides: ["ny"], data: BirchTopImage },
          { name: "Sand", sides: all, data: SandImage },
          { name: "Snow", sides: all, data: SnowImage },
          { name: "Water", sides: all, data: WaterImage },
          { name: "Obsidian", sides: all, data: ObsidianImage },
          { name: "Granite", sides: all, data: GraniteImage },
          { name: "Graphite", sides: all, data: GraphiteImage },
          { name: "Slate", sides: all, data: SlateImage },
          { name: "Andesite", sides: all, data: AndesiteImage },
          { name: "Oak Planks", sides: all, data: OakPlanksImage },
          { name: "Oak Slab Top", sides: all, data: OakPlanksImage },
          { name: "Oak Slab Bottom", sides: all, data: OakPlanksImage },
          { name: "ChoGe", sides: ["px", "nx"], data: ChoGeImage },
        ]);

        client.current.chat.addCommand(
          "image-voxelize",
          ImageVoxelizer.commander
        );

        client.current.chat.addCommand(
          "hand",
          (rest: string, client: Client) => {
            const block = client.registry.getBlockByName(rest.trim());

            if (block) {
              client.controls.hand = block.name;
              client.chat.add({
                type: "INFO",
                body: "Client is now holding: " + block.name,
              });
            } else {
              const id = parseInt(rest, 10);

              if (!isNaN(id)) {
                const block = client.registry.getBlockById(id);

                if (block) {
                  client.controls.hand = block.name;
                  client.chat.add({
                    type: "INFO",
                    body: "Client is now holding: " + block.name,
                  });
                  return;
                }
              }

              client.chat.add({
                type: "ERROR",
                body: "Unknown block: " + rest,
              });
            }
          }
        );

        client.current.chat.addCommand("blocks", (_, client: Client) => {
          const list: any[] = [];

          client.registry.blocksById.forEach((block, id) => {
            list.push([id, block]);
          });

          list.sort((a, b) => a[0] - b[0]);

          client.chat.add({
            type: "INFO",
            body: list
              .map(([id, block]) => `${id}: ${block.name}`)
              .join("<br/>"),
          });
        });

        client.current.chat.addCommand("allblocks", (_, client: Client) => {
          const list: any[] = [];

          client.registry.blocksById.forEach((block, id) => {
            list.push([id, block]);
          });

          list.sort((a, b) => a[0] - b[0]);

          const [vx, vy, vz] = client.controls.voxel;

          const updates: BlockUpdate[] = [];
          for (let x = 0; x < list.length; x++) {
            const [id] = list[x];
            updates.push({ vx: vx + x, vy, vz, type: id });
          }

          client.world.setServerVoxels(updates);
        });

        client.current.ecs.addSystem(new UpdateBoxSystem());

        client.current?.connect({
          secret: "test",
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

        setName(client.current.username);
      }

      joinOrResume(false);
    }
  }, []);

  useEffect(() => {
    if (client.current) {
      client.current.setUsername(name);
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
