---
name: voxelize-voice-chat
description: Add proximity voice chat to a Voxelize game - players hear the others standing near them, fading with distance and coming from where each one stands. Covers turning it on per world (voice_range), VoiceChat on the client (microphone, push-to-talk or open mic, mute, deafen, per-player mute and volume, a microphone test), what a game's UI reads to draw who is speaking, and how the server decides who hears whom. Use when adding voice chat, a talk key, a speaking indicator, a voice settings screen, or when voice is silent, cut off, or heard by the wrong players.
library: "@voxelize/core"
library_version: "3.0.0"
sources:
  - packages/core/src/core/voice/voice-chat.ts
  - packages/core/src/core/voice/falloff.ts
  - packages/core/src/core/voice/gate.ts
  - packages/core/src/core/voice/sink.ts
  - packages/core/src/core/voice/capture.ts
  - packages/protocol/src/types.ts
  - server/world/voice.rs
  - examples/client/src/voice.ts
---

# Proximity voice in Voxelize

The server relays; it never mixes or decodes. A client uploads its microphone as Opus packets, the world hands each one to the clients standing within range of the speaker, and each of those plays it from where the speaker stands. There is no peer-to-peer connection, so no player learns another's address and no extra port is needed: voice rides the session's WebSocket up, and the WebRTC data channel (or the WebSocket) down.

The worked version is `examples/client/src/voice.ts` and the `voice_range` line in `examples/server/worlds`.

## Server: one option

```rust
let config = WorldConfig::new()
    .voice_range(Some(24.0)) // blocks; None (the default) is no voice
    .build();
```

`voice_range` is where a listener's falloff reaches silence; the world delivers 4 blocks further so a fade is never cut short. It may not exceed `peer_visible_radius`: a voice needs a body to come from. A game that sets many worlds up through one function can call `world.set_voice_range(Some(24.0))` on a built world instead.

Who hears a frame is the server's call, never the client's:

- only clients that turned voice on are sent anything;
- a client is never sent a speaker it muted (`ignored`), nor anything while deafened;
- only a client whose mic is live may send, at most 60 frames a second of at most 1275 bytes;
- `world.set_voice_guard(|world, speaker_id| ...)` lets the game silence a speaker by its own rules (a spectator, a player a moderator muted).

## Client: `VoiceChat`

```ts
const voice = new VOXELIZE.VoiceChat();
network.register(voice); // before network.join, so it reads the world's range

// From a click or a key press: this opens the browser's microphone prompt.
button.onclick = () => voice.enable();

// Every frame: the ear, and where each speaker stands.
voice.update({ position, forward, up }, (id) =>
  peers.getPeerById(id)?.position.toArray(),
);
```

Registered after the join, tell it the world yourself: `voice.joinWorld(peers.ownID, world.options.voiceRange)`.

`VoiceChat` options worth knowing:

- `audioContext`: the context voices play on. Pass the game's own (`THREE.AudioContext.getContext()`) so voice shares its output device, with `managesListener: false` when a `THREE.AudioListener` on the camera already moves the listener.
- `fullVolumeDistance` (4 blocks): a voice is at full volume this close. Past it the gain is `voiceFalloffGain`: inverse distance, windowed to exactly zero at the range.

Controls, all safe to call at any time:

| Call | What it does |
| --- | --- |
| `enable({ withMicrophone })` / `disable()` | Voice on or off. A refused microphone leaves the player listening (`micStatus` says why). |
| `setActivation("push-to-talk" \| "open-mic")` | How the mic opens. Push-to-talk is the default. |
| `setTalkKeyHeld(isHeld)` | Push-to-talk: call on key down and key up. Listen for the key up on `window`, so a release while a menu has focus still closes the mic. |
| `setThreshold(level)` | Open mic: the level, 0..1, that opens the gate. `voice.inputLevel` is the live reading on the same scale, for a meter. |
| `setMicMuted`, `setDeafened` | Stop sending; stop hearing (and sending). |
| `setSpeakerMuted(id, isMuted)`, `setSpeakerVolume(id, volume)` | The player's own mute and volume (0..2) for one speaker. A mute is kept by the server. |
| `setVolume(volume)` | All voices together, 0..2. |
| `setTesting(isTesting)` | Hear your own microphone through the same encoder and decoder everyone else gets; nothing is sent meanwhile. |
| `setInputDevice(deviceId)` | Pick a microphone; `listVoiceInputDevices()` names them once permission is granted. |
| `setSpeakerMuffle(id, amount)` | 0..1: how much stands between the ear and a speaker. The game works it out (a voxel ray); the voice is low-passed and a little quieter. |

## Drawing it

`VoiceChat` draws nothing. A game's UI reads:

- `voice.getState()` with `voice.subscribe(listener)`: `isEnabled`, `micStatus`, `isMicMuted`, `isDeafened`, `isTransmitting`, `isTesting`, `range`. A new object whenever something changed, so it works with `useSyncExternalStore`.
- `voice.getSpeakers()` with `voice.subscribeSpeakers(listener)`: who is heard right now, nearest first, each with `level` (0..1, of the sound playing now), `distance` and `falloff`. Only audible voices are listed: one arriving from the relay's margin, past the range, is not. The array is replaced when someone starts or stops; `level` and `distance` move in place every `update`, so read them from an animation frame.
- each peer's metadata key `voice`, `{ mic: "off" | "muted" | "live", deafened }` (typed as PeerVoiceState in `@voxelize/protocol`): what that player told the server, for a muted or deafened mark on their name.

"Speaking" comes from the frames that actually reach this client, so an indicator built on `getSpeakers()` never shows a voice the player cannot hear.

## When something is off

Start with `voice.getStats()`: frames sent and received, and for each speaker the frames that came late, never came, were dropped to catch up, or would not decode. Zero received means the server is not sending (range, voice state, a mute); frames received with many dropped means the page is too busy to play them.

- **Nothing is sent**: `voice.isAvailable` is false until the INIT of a world with a `voice_range` arrives; `micStatus` is `blocked`, `no-device` or `failed` when the microphone would not open; in push-to-talk nothing is sent unless `setTalkKeyHeld(true)`.
- **Silent after a reload**: a context created without a user gesture starts suspended. Call `voice.resume()` from the page's next click or key press.
- **Heard too far, or not far enough**: the range is the server's `voice_range`; the client reads it from INIT and cannot stretch it.
- **Choppy under a busy main thread**: playout starts 60 ms ahead and grows to 240 ms after underruns (`VoicePlayout`); frames arriving out of order are held up to 60 ms (`VoiceJitterBuffer`). Both take options through the `stream` option.
