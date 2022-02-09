import { Client } from "@voxelize/client";
import { useEffect } from "react";

export const App = () => {
  useEffect(() => {
    const client = new Client();

    client.connect({
      serverURL: "http://localhost:5000",
      reconnectTimeout: 5000,
      room: "test",
    });
  }, []);

  return <div>hi</div>;
};
