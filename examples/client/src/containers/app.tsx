import { Client } from "@voxelize/client";
import { useEffect, useRef, useState } from "react";

export const App = () => {
  const [room, setRoom] = useState("test");
  const client = useRef<Client | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (container.current) {
      client.current = new Client({
        container: {
          domElement: container.current,
        },
      });
    }
  }, []);

  const onConnect = () => {
    if (!client.current) return;

    client.current.disconnect();
    client.current.connect({
      serverURL: "http://localhost:5000",
      reconnectTimeout: 5000,
      room,
    });
  };

  const onDisconnect = () => {
    if (!client.current) return;

    client.current.disconnect();
  };

  const onSignal = () => {
    if (!client.current) return;

    client.current.peers.broadcast({
      type: "PEER",
    });
  };

  return (
    <div>
      <input value={room} onChange={(e) => setRoom(e.target.value)} />
      <button onClick={onConnect}>connect</button>
      <button onClick={onDisconnect}>disconnect</button>
      <button onClick={onSignal}>signal</button>
      <div
        style={{ background: "black", width: 800, height: 600 }}
        ref={container}
      />
    </div>
  );
};
