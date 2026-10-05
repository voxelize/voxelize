// Proximity voice (V switches it on and off). Browsers talk directly over
// WebRTC; the game server pairs players who are near each other and carries
// the connection setup (`platform.voice.*`). Each voice is placed where the
// speaker stands and fades with distance, so nearby players are heard and
// far ones are not.

/** Blocks within which a voice is at full volume, and where it falls silent. */
export const VOICE_NEAR = 4;
export const VOICE_FAR = 32;

/** Volume of a voice at a distance: full up close, silent past VOICE_FAR. */
export function voiceGain(distance: number): number {
  if (distance <= VOICE_NEAR) return 1;
  if (distance >= VOICE_FAR) return 0;
  return 1 - (distance - VOICE_NEAR) / (VOICE_FAR - VOICE_NEAR);
}

/** Who starts a pair's connection (the other answers): the smaller id. */
export const initiates = (me: string, them: string) => me < them;

/** Peers to connect to and to drop when the list changes. */
export function peerChanges(current: Iterable<string>, next: string[]): { add: string[]; drop: string[] } {
  const now = new Set(current);
  const want = new Set(next);
  return { add: next.filter((p) => !now.has(p)), drop: [...now].filter((p) => !want.has(p)) };
}

type Signal = { from: string; kind: "offer" | "answer" | "ice"; data: unknown };
type Link = { pc: RTCPeerConnection; gain?: GainNode; panner?: PannerNode; audio?: HTMLAudioElement; pending: RTCIceCandidateInit[] };

export type VoiceHost = {
  /** This player's id (the engine's client id). */
  me: () => string;
  /** Send an intent to the game server. */
  call: (intent: string, payload: unknown) => void;
  /** Where a player's head is, if they are drawn here. */
  positionOf: (id: string) => [number, number, number] | null;
  /** Where we listen from and which way we face. */
  listener: () => { at: [number, number, number]; forward: [number, number, number] };
  notify: (text: string) => void;
};

export class VoiceChat {
  private links = new Map<string, Link>();
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private ice: RTCIceServer[] = [];
  enabled = false;

  constructor(private readonly host: VoiceHost) {}

  /** Peers with a live connection (for tests and the HUD). */
  get connected(): string[] {
    return [...this.links].filter(([, l]) => l.pc.connectionState === "connected").map(([id]) => id);
  }

  async toggle() {
    if (this.enabled) return this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      this.host.notify("Voice needs the microphone");
      return;
    }
    this.context = new AudioContext();
    this.enabled = true;
    this.host.call("platform.voice.join", {});
    this.host.notify("Voice on: players nearby hear you (V to stop)");
  }

  stop() {
    this.enabled = false;
    this.host.call("platform.voice.leave", {});
    for (const id of [...this.links.keys()]) this.drop(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.host.notify("Voice off");
  }

  /** The server's answer to voice.join: ICE servers to use. */
  joined(result: { ice_servers?: RTCIceServer[] }) {
    this.ice = Array.isArray(result.ice_servers) ? result.ice_servers : [];
  }

  /** `platform.voice.peers`: whom to be connected to now. */
  setPeers(peers: { id: string }[]) {
    if (!this.enabled) return;
    const { add, drop } = peerChanges(this.links.keys(), peers.map((p) => p.id));
    drop.forEach((id) => this.drop(id));
    for (const id of add) {
      const link = this.open(id);
      if (initiates(this.host.me(), id)) void this.offer(id, link);
    }
  }

  /** `platform.voice.signal`: setup from a paired player. */
  async signal({ from, kind, data }: Signal) {
    if (!this.enabled) return;
    const link = this.links.get(from) ?? (kind === "offer" ? this.open(from) : undefined);
    if (!link) return;
    try {
      if (kind === "offer" || kind === "answer") {
        await link.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
        for (const c of link.pending.splice(0)) await link.pc.addIceCandidate(c);
        if (kind === "offer") {
          await link.pc.setLocalDescription(await link.pc.createAnswer());
          this.send(from, "answer", link.pc.localDescription?.toJSON());
        }
      } else if (link.pc.remoteDescription) await link.pc.addIceCandidate(data as RTCIceCandidateInit);
      else link.pending.push(data as RTCIceCandidateInit);
    } catch (e) {
      console.warn("[voice] setup with", from, "failed", e);
    }
  }

  /** Every frame: place each voice where its speaker stands. */
  update() {
    const ctx = this.context;
    if (!ctx) return;
    const { at, forward } = this.host.listener();
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = at[0];
      l.positionY.value = at[1];
      l.positionZ.value = at[2];
      l.forwardX.value = forward[0];
      l.forwardY.value = forward[1];
      l.forwardZ.value = forward[2];
    }
    for (const [id, link] of this.links) {
      const p = this.host.positionOf(id);
      if (!link.gain || !link.panner) continue;
      if (!p) {
        link.gain.gain.value = 0;
        continue;
      }
      link.panner.positionX.value = p[0];
      link.panner.positionY.value = p[1];
      link.panner.positionZ.value = p[2];
      link.gain.gain.value = voiceGain(Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]));
    }
  }

  private send(to: string, kind: Signal["kind"], data: unknown) {
    this.host.call("platform.voice.signal", { to, kind, data });
  }

  private open(id: string): Link {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const link: Link = { pc, pending: [] };
    this.links.set(id, link);
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream!));
    pc.onicecandidate = (e) => e.candidate && this.send(id, "ice", e.candidate.toJSON());
    pc.ontrack = (e) => {
      const ctx = this.context;
      if (!ctx || link.gain) return;
      // Chrome only plays a remote stream through Web Audio while a media
      // element holds it too (muted: the panner is what we hear).
      link.audio = Object.assign(new Audio(), { srcObject: e.streams[0], muted: true });
      void link.audio.play().catch(() => {});
      const source = ctx.createMediaStreamSource(e.streams[0]);
      link.panner = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "linear", refDistance: VOICE_NEAR, maxDistance: VOICE_FAR, rolloffFactor: 0 });
      link.gain = ctx.createGain();
      source.connect(link.panner).connect(link.gain).connect(ctx.destination);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.drop(id);
    };
    return link;
  }

  private async offer(id: string, link: Link) {
    await link.pc.setLocalDescription(await link.pc.createOffer());
    this.send(id, "offer", link.pc.localDescription?.toJSON());
  }

  private drop(id: string) {
    const link = this.links.get(id);
    if (!link) return;
    link.pc.close();
    link.gain?.disconnect();
    link.audio?.pause();
    this.links.delete(id);
  }
}
