import { Client, Network } from "@voxelize/client";
import { useEffect } from "react";

export const App = () => {
  useEffect(() => {
    const network = new Network({
      serverURL: "http://localhost:5000",
      reconnectTimeout: 5000,
    });

    const client = new Client({
      network,
    });

    client.connect();
  }, []);

  return <div>hi</div>;
};
