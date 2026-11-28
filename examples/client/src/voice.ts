import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three/webgpu";

/// The example's proximity voice: everything a game needs to wire.
///
/// The server side is one line, `.voice_range(Some(24.0))` on the world's
/// config (examples/server/worlds). Here: make a `VoiceChat`, register it on
/// the network before joining, turn it on from a key press (the browser
/// only opens a microphone from a user gesture), hold the same key to talk,
/// and tell it every frame where the ear is and where each speaker stands.
///
/// It draws nothing. A game's own UI reads `voice.getState()` (is it on, is
/// the mic live), `voice.getSpeakers()` (who is heard, how loud, how far)
/// and each peer's `voice` metadata (`{ mic, deafened }`).

const TALK_KEY = "KeyI";

export function setupVoice({
  network,
  inputs,
  camera,
  positionOf,
}: {
  network: VOXELIZE.Network;
  inputs: Pick<VOXELIZE.Inputs<"menu" | "in-game" | "chat">, "bind">;
  camera: THREE.Camera;
  /** Where the peer with this client id stands, if it is known. */
  positionOf: (id: string) => THREE.Vector3 | undefined;
}) {
  const voice = new VOXELIZE.VoiceChat();
  network.register(voice);

  // First press turns voice on (and asks for the microphone); after that the
  // key is push-to-talk.
  inputs.bind(
    TALK_KEY,
    () => {
      if (!voice.isAvailable) return;
      if (!voice.getState().isEnabled) {
        void voice.enable();
        return;
      }
      voice.setTalkKeyHeld(true);
    },
    "in-game",
    { identifier: "voice" },
  );
  window.addEventListener("keyup", (event) => {
    if (event.code === TALK_KEY) voice.setTalkKeyHeld(false);
  });

  const ear = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();

  return {
    voice,
    /** Call once a frame. */
    update() {
      camera.getWorldPosition(ear);
      camera.getWorldDirection(forward);
      up.copy(camera.up).applyQuaternion(camera.quaternion);
      voice.update(
        {
          position: [ear.x, ear.y, ear.z],
          forward: [forward.x, forward.y, forward.z],
          up: [up.x, up.y, up.z],
        },
        (id) => {
          const at = positionOf(id);
          return at ? [at.x, at.y, at.z] : null;
        },
      );
    },
  };
}
