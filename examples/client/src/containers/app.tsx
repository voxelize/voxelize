import { Client } from "@voxelize/client";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

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
    padding: 24px 32px;
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

  & button,
  & input {
    padding: 4px 0px;
  }

  & h3,
  button {
    color: #eee;
  }

  & .room {
    display: flex;
    align-items: center;
    border-radius: 4px;
    overflow: hidden;

    & * {
      flex: 1;
      height: 100%;
      font-size: 1rem;
    }

    & input {
      border-radius: 0;
      border: none;
      width: 100px;
      outline: none;
      padding: 4px;
    }

    & span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #313552;
      color: white;
      padding: 4px 8px;
    }
  }

  & h3 {
    margin-bottom: 12px;
  }

  & button {
    cursor: pointer;
    background: transparent;
    text-transform: uppercase;
    border: none;
    border-bottom: 1px solid transparent;

    &:hover {
      border-bottom-color: #eee;
    }
  }
`;

const BACKEND_SERVER = "http://localhost:5000/?room=";

export const App = () => {
  const [room, setRoom] = useState("test");
  const [connected, setConnected] = useState(false);
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
      }

      connectOrResume();
    }
  }, []);

  const connectOrResume = () => {
    if (!client.current) return;

    client.current.controls.lock();

    if (connected) return;

    client.current.disconnect().then(() => {
      client.current?.connect({
        serverURL: BACKEND_SERVER,
        reconnectTimeout: 5000,
        room,
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
            <h3>Voxelize Demo!</h3>
            <div className="room">
              <span>room</span>
              <input
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                disabled={connected}
              />
            </div>
            <button onClick={connectOrResume}>
              {connected ? "resume" : "connect"}
            </button>
            {connected && <button onClick={disconnect}>disconnect</button>}
          </div>
        </ControlsWrapper>
      )}
    </GameWrapper>
  );
};
