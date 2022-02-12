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

export const App = () => {
  const [room, setRoom] = useState("test");
  const client = useRef<Client | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (container.current) {
      if (!client.current)
        client.current = new Client({
          container: {
            domElement: container.current,
          },
        });
      connect();
    }
  }, []);

  const connect = () => {
    if (!client.current) return;

    client.current.disconnect();
    client.current.connect({
      serverURL: "http://localhost:5000",
      reconnectTimeout: 5000,
      room,
    });
  };

  const disconnect = () => {
    if (!client.current) return;

    client.current.disconnect();
  };

  return (
    <GameWrapper ref={container}>
      <input value={room} onChange={(e) => setRoom(e.target.value)} />
      <button onClick={connect}>connect</button>
      <button onClick={disconnect}>disconnect</button>
    </GameWrapper>
  );
};
