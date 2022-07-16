import { Button } from "../components/button";
import { Input } from "../components/input";
import { Client } from "@voxelize/client";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

import LogoImage from "../assets/tree_transparent.svg";

import { setupClient } from "src/core/client";

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

const App = () => {
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
        const newClient = setupClient(container.current);

        client.current = newClient;

        newClient.on("unlock", () => {
          setLocked(false);
        });

        newClient.on("lock", () => {
          setLocked(true);
        });

        newClient.on("chat-enabled", () => {
          setChatEnabled(true);
        });

        newClient.on("chat-disabled", () => {
          setChatEnabled(false);
        });

        newClient.on("join", () => {
          setJoined(true);
        });

        newClient.on("leave", () => {
          setJoined(false);
        });

        setName(newClient.username);

        joinOrResume(false);
      }
    }
  }, [container]);

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

export default App;
