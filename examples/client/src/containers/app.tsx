import { Client } from "@voxelize/client";
import { useRef, useState } from "react";

export const App = () => {
  const [room, setRoom] = useState("test");
  const client = useRef(new Client());

  const onConnect = () => {
    client.current.disconnect();
    client.current.connect({
      serverURL: "http://localhost:5000",
      reconnectTimeout: 5000,
      room,
    });
  };

  const onDisconnect = () => {
    client.current.disconnect();
    setRoom("");
  };

  const onSignal = () => {
    client.current.network?.sendToPeers({
      type: "PEER",
    });
  };

  return (
    <div>
      <input value={room} onChange={(e) => setRoom(e.target.value)} />
      <button onClick={onConnect}>connect</button>
      <button onClick={onDisconnect}>disconnect</button>
      <button onClick={onSignal}>signal</button>
    </div>
  );
};
