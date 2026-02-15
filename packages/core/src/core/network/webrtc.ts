const FRAGMENT_HEADER_SIZE = 9;
const MAX_FRAGMENT_COUNT = 4096;
const MAX_PENDING_MESSAGES = 64;
const FRAGMENT_MARKER = 0xff;
const LEGACY_FRAGMENT_MARKER = 0x01;

const readUint32LE = (bytes: Uint8Array, offset: number): number => {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
};

const toHttpProtocol = (protocol: string) => {
  if (protocol.startsWith("wss")) {
    return "https:";
  }
  if (protocol.startsWith("ws")) {
    return "http:";
  }
  return protocol;
};

type FragmentState = {
  parts: Array<Uint8Array | null>;
  received: number;
  total: number;
};

export class WebRTCConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private fragments = new Map<number, FragmentState>();
  private nextMessageId = 0;

  onMessage: ((data: ArrayBuffer) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  get isConnected(): boolean {
    return this.dc?.readyState === "open";
  }

  async connect(serverUrl: string, clientId: string): Promise<void> {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    this.dc = this.pc.createDataChannel("voxelize", {
      ordered: false,
      maxRetransmits: 0,
    });
    this.dc.binaryType = "arraybuffer";

    this.dc.onopen = () => {
      this.onOpen?.();
    };

    this.dc.onclose = () => {
      this.onClose?.();
    };

    this.dc.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data as ArrayBuffer);
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const baseUrl = new URL(serverUrl);
    baseUrl.protocol = toHttpProtocol(baseUrl.protocol);

    const offerUrl = new URL("/rtc/offer", baseUrl);

    const response = await fetch(offerUrl.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        sdp: offer.sdp,
        client_id: clientId,
      }),
    });

    if (!response.ok) {
      throw new Error(`RTC offer failed: ${response.status}`);
    }

    const { sdp: answerSdp } = await response.json();

    await this.pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });
  }

  close(): void {
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
    this.fragments.clear();
  }

  private handleMessage(data: ArrayBuffer): void {
    if (data.byteLength < 1) {
      return;
    }

    const bytes = new Uint8Array(data);
    const marker = bytes[0];
    const isFragment = marker === FRAGMENT_MARKER;
    const isLegacyFragment = marker === LEGACY_FRAGMENT_MARKER;

    if (!isFragment && !isLegacyFragment) {
      this.onMessage?.(data);
      return;
    }

    if (data.byteLength < FRAGMENT_HEADER_SIZE) {
      if (isLegacyFragment) {
        this.onMessage?.(data);
      }
      return;
    }

    const total = readUint32LE(bytes, 1);
    const index = readUint32LE(bytes, 5);
    const payload = bytes.subarray(FRAGMENT_HEADER_SIZE);
    if (total === 0 || total > MAX_FRAGMENT_COUNT || index >= total) {
      if (isLegacyFragment) {
        this.onMessage?.(data);
      }
      return;
    }
    if (total === 1) {
      if (isLegacyFragment) {
        this.onMessage?.(data);
      } else {
        this.onMessage?.(data.slice(FRAGMENT_HEADER_SIZE));
      }
      return;
    }
    if (index !== 0 && this.nextMessageId === 0) {
      if (isLegacyFragment) {
        this.onMessage?.(data);
      }
      return;
    }
    if (index === 0 && this.fragments.size >= MAX_PENDING_MESSAGES) {
      this.fragments.clear();
      this.nextMessageId = 0;
    }

    const messageId =
      index === 0 ? this.nextMessageId++ : this.nextMessageId - 1;
    let fragmentState = this.fragments.get(messageId);
    if (!fragmentState) {
      if (index !== 0) {
        if (isLegacyFragment) {
          this.onMessage?.(data);
        }
        return;
      }
      fragmentState = {
        parts: new Array<Uint8Array | null>(total).fill(null),
        received: 0,
        total,
      };
      this.fragments.set(messageId, fragmentState);
    } else if (fragmentState.total !== total || index >= fragmentState.total) {
      if (isLegacyFragment) {
        this.onMessage?.(data);
      }
      return;
    }
    if (fragmentState.parts[index] === null) {
      fragmentState.received++;
    }
    fragmentState.parts[index] = payload;

    if (fragmentState.received === fragmentState.total) {
      let totalLength = 0;
      for (let i = 0; i < fragmentState.total; i++) {
        const frag = fragmentState.parts[i];
        if (!frag) {
          this.fragments.delete(messageId);
          return;
        }
        totalLength += frag.byteLength;
      }

      const complete = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < fragmentState.total; i++) {
        const frag = fragmentState.parts[i];
        if (!frag) {
          this.fragments.delete(messageId);
          return;
        }
        complete.set(frag, offset);
        offset += frag.byteLength;
      }

      this.fragments.delete(messageId);
      this.onMessage?.(complete.buffer);
    }
  }
}
