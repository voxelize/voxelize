import { Client } from "@voxelize/client";
import { useEffect } from "react";

export const App = () => {
  useEffect(() => {
    const client = new Client({
      serverURL: "http://localhost:5000",
    });
    client.connect();
  }, []);

  return <div>hi</div>;
};
