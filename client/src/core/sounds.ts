import { Client } from "src";
import { PositionalAudio, Audio } from "three";

type SoundParams = {
  loop: boolean;
  positional: boolean;
  maxVolume: number;
  refDistance: number;
};

const defaultParams: SoundParams = {
  loop: false,
  positional: false,
  maxVolume: 1,
  refDistance: 10,
};

/**
 * A **built-in** audio manager that manages the sounds in the game.
 */
class Sounds {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  private sourceMap: Map<string, string> = new Map();

  constructor(client: Client) {
    this.client = client;
  }

  register = (name: string, source: string) => {
    this.client.loader.addAudioSource(source);
    this.sourceMap.set(name, source);
  };

  make = (name: string, params: Partial<SoundParams> = {}) => {
    const { loop, maxVolume, positional, refDistance } = {
      ...defaultParams,
      ...params,
    };

    const source = this.sourceMap.get(name);
    const buffer = this.client.loader.getAudioBuffer(source);

    if (!buffer) {
      return;
    }

    const { listener } = this.client.camera;
    const sound = positional
      ? new PositionalAudio(listener)
      : new Audio(listener);

    sound.setBuffer(buffer);
    sound.setLoop(loop);
    sound.setVolume(maxVolume);

    if (positional) {
      (sound as PositionalAudio).setRefDistance(refDistance);
    }

    return sound;
  };
}

export { Sounds };
