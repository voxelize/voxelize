import { Button } from "@components/button";
import { Input } from "@components/input";
import {
  Client,
  BaseEntity,
  NameTag,
  Position3DComponent,
  TargetComponent,
  HeadingComponent,
  System,
  EntityFlag,
} from "@voxelize/client";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import MarbleImage from "../assets/marble.jpg";
import { BoxBufferGeometry, MeshNormalMaterial, Mesh } from "three";

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
  border: 2px solid #eee1;
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
    ]);
  }

  update(entity: BaseEntity) {
    const { mesh, position, target } = entity;
    mesh.position.lerp(position, BaseEntity.LERP_FACTOR);
    mesh.lookAt(target);
  }
}

export const App = () => {
  const [world, setWorld] = useState("world1");
  const [name, setName] = useState("");
  const [connected, setConnected] = useState(false);
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

        client.current.registerEntity("Box", Box);
        client.current.registry.applyTextureByName(
          "Marble",
          "all",
          MarbleImage
        );

        client.current.addSystem(new UpdateBoxSystem());

        client.current.on("unlock", () => {
          setShowControls(true);
        });

        client.current.on("lock", () => {
          setShowControls(false);
        });

        client.current.on("connected", () => {
          setConnected(true);
        });

        client.current.on("disconnected", () => {
          setConnected(false);
        });

        setName(client.current.name);
      }

      connectOrResume(false);
    }
  }, []);

  useEffect(() => {
    if (client.current) {
      client.current.setName(name);
    }
  }, [name]);

  const connectOrResume = (lock = true) => {
    if (!client.current) return;

    if (connected) {
      if (lock) {
        client.current.controls.lock();
      }
      return;
    }

    client.current.disconnect().then(() => {
      client.current
        ?.connect({
          serverURL: BACKEND_SERVER,
          reconnectTimeout: 5000,
          world,
        })
        .then((success) => {
          if (success) {
            if (lock) {
              client.current?.controls.lock();
            }
          } else {
            setError("World not found.");
          }
        });
    });
  };

  const disconnect = () => {
    if (!client.current) return;

    client.current.disconnect();
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
              disabled={connected}
            />
            {connected && (
              <Input
                label="name"
                onChange={(e) => setName(e.target.value)}
                maxLength={16}
                value={name}
              />
            )}
            <Button onClick={() => connectOrResume()}>
              {connected ? "resume" : "connect"}
            </Button>
            {connected && <Button onClick={disconnect}>disconnect</Button>}
            <span className="error">{error}</span>
          </div>
        </ControlsWrapper>
      )}
    </GameWrapper>
  );
};
