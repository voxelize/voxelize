import { Client } from "@voxelize/client";
import { Audio, PositionalAudio } from "three";
import PlopSound from "../assets/plop.ogg";
import WalkingSound from "../assets/walking.wav";

export function setupSounds(client: Client) {
  client.sounds.register("plop", PlopSound);
  client.sounds.register("walking", WalkingSound);

  let sound: Audio | PositionalAudio;
  client.controls.onAfterUpdate = () => {
    if (!sound) {
      sound = client.sounds.make("walking", { loop: true });
      if (!sound) return;

      sound.setVolume(0.3);
    }

    if (client.controls.state.running && client.controls.body.atRestY === -1) {
      if (!sound.isPlaying) {
        sound.play();
      }
    } else {
      sound.pause();
    }
  };
}
