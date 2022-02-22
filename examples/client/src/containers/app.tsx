import { Button } from "@components/button";
import { Input } from "@components/input";
import { Client, Entity, NameTag, Head } from "@voxelize/client";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { BoxBufferGeometry, MeshNormalMaterial, Scene } from "three";

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

const BACKEND_SERVER = "http://localhost:5000/?room=";

class Box extends Entity {
  public geometry: BoxBufferGeometry;
  public material: MeshNormalMaterial;

  constructor() {
    super();

    // this.geometry = new BoxBufferGeometry(0.5, 0.5, 0.5);
    // this.material = new MeshNormalMaterial();
    // this.mesh = new Mesh(this.geometry, this.material);
    this.mesh = new Head({ headDimension: 0.3 }).mesh;

    const nameTag = new NameTag("BOX", {
      backgroundColor: "#00000077",
      fontFace: "Syne Mono",
      fontSize: 0.2,
      yOffset: 0.3,
    });

    this.mesh.add(nameTag);
  }

  onCreation = (scene: Scene) => {
    scene.add(this.mesh);
  };
}

export const App = () => {
  const [room, setRoom] = useState("test");
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

        console.log(client.current.name);
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
          room,
        })
        .then((success) => {
          if (success) {
            if (lock) {
              client.current?.controls.lock();
            }
          } else {
            setError("Room not found.");
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
      {showControls && (
        <ControlsWrapper>
          <div>
            <img
              src="https://cdn-icons-png.flaticon.com/512/226/226904.png"
              alt="logo"
            />
            <h3>Voxelize Demo!</h3>
            <Input
              label="room"
              value={room}
              onChange={(e) => {
                setRoom(e.target.value);
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
