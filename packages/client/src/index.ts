import { EventEmitter } from "events";

import {
  Container,
  ContainerParams,
  World,
  WorldParams,
  Network,
  RenderingParams,
  Rendering,
  Camera,
  CameraParams,
  Peers,
  PeersParams,
  Inputs,
  Clock,
  Controls,
  ControlsParams,
} from "./core";
import { Debug } from "./core/debug";

type ClientParams = {
  container?: Partial<ContainerParams>;
  rendering?: Partial<RenderingParams>;
  world?: Partial<WorldParams>;
  camera?: Partial<CameraParams>;
  peers?: Partial<PeersParams>;
  controls?: Partial<ControlsParams>;
};

class Client extends EventEmitter {
  public name = "test";

  public network: Network | undefined;

  public debug: Debug;
  public container: Container;
  public rendering: Rendering;
  public inputs: Inputs;
  public clock: Clock;
  public controls: Controls;
  public camera: Camera;
  public world: World;
  public peers: Peers;

  private animationFrame: number;

  constructor(params: ClientParams = {}) {
    super();

    const { container, rendering, world, camera, peers, controls } = params;

    this.debug = new Debug(this);
    this.container = new Container(this, container);
    this.rendering = new Rendering(this, rendering);
    this.world = new World(this, world);
    this.camera = new Camera(this, camera);
    this.peers = new Peers(this, peers);
    this.controls = new Controls(this, controls);
    this.inputs = new Inputs(this);
    this.clock = new Clock(this);

    // all members has been initialized
    this.emit("initialized");
  }

  connect = async ({
    room,
    serverURL,
    reconnectTimeout,
  }: {
    room: string;
    serverURL: string;
    reconnectTimeout?: number;
  }) => {
    reconnectTimeout = reconnectTimeout || 5000;

    // re-instantiate networking instance
    const network = new Network(this, { reconnectTimeout, serverURL });
    const hasRoom = await network.fetch("has-room", { room });

    if (!hasRoom) {
      console.error("Room not found.");
      return false;
    }

    network.connect(room).then(() => {
      console.log(`Joined room "${room}"`);
    });

    this.network = network;

    this.run();

    return true;
  };

  disconnect = async () => {
    this.peers.dispose();

    if (this.network) {
      this.network.disconnect();
      console.log(`Left room "${this.network.room}"`);
    }

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    this.network = undefined;
  };

  setName = (name: string) => {
    this.name = name;
  };

  private run = () => {
    const animate = () => {
      this.animationFrame = requestAnimationFrame(animate);
      this.animate();
    };

    animate();
  };

  private animate = () => {
    this.clock.tick();
    this.camera.tick();
    this.peers.tick();
    this.controls.tick();
    this.debug.tick();

    this.rendering.render();
  };
}

export { Client };

export * from "./core";
