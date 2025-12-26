export interface WebRTCConnectionOptions {
  secret?: string;
  iceServers?: RTCIceServer[];
}

const FRAGMENT_MARKER = 0xff;
const FRAGMENT_HEADER_SIZE = 9;
const MAX_FRAGMENT_SIZE = 32000;
const MAX_PAYLOAD_SIZE = MAX_FRAGMENT_SIZE - FRAGMENT_HEADER_SIZE;

interface FragmentBuffer {
  fragments: Map<number, Uint8Array>;
  totalFragments: number;
  receivedCount: number;
  totalSize: number;
}

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private clientId = "";
  private secret = "";
  private fragmentBuffers: Map<number, FragmentBuffer> = new Map();
  private sendMessageIdCounter = 0;

  onMessage: ((data: ArrayBuffer) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(
    private serverUrl: string,
    options: WebRTCConnectionOptions = {}
  ) {
    this.secret = options.secret ?? "";
    this.pc = new RTCPeerConnection({
      iceServers: options.iceServers ?? [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    this.pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE connection state:", this.pc.iceConnectionState);
      if (
        this.pc.iceConnectionState === "disconnected" ||
        this.pc.iceConnectionState === "failed" ||
        this.pc.iceConnectionState === "closed"
      ) {
        this.onClose?.();
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", this.pc.connectionState);
    };
  }

  async connect(clientId?: string): Promise<string> {
    this.dc = this.pc.createDataChannel("voxelize", {
      ordered: false,
      maxRetransmits: 0,
    });

    this.dc.binaryType = "arraybuffer";

    this.dc.onopen = () => {
      console.log("[WebRTC] DataChannel opened");
      this.onOpen?.();
    };

    this.dc.onclose = () => {
      console.log("[WebRTC] DataChannel closed");
      this.onClose?.();
    };

    this.dc.onerror = (e) => {
      console.error("[WebRTC] DataChannel error:", e);
    };

    this.dc.onmessage = (e) => {
      this.handleIncomingMessage(e.data);
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    await this.waitForIceGathering();

    const response = await fetch(`${this.serverUrl}/rtc/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        secret: this.secret,
        sdp: this.pc.localDescription?.sdp,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to establish WebRTC connection: ${error.error}`);
    }

    const { client_id, sdp } = await response.json();
    this.clientId = client_id;

    await this.pc.setRemoteDescription({ type: "answer", sdp });

    console.log("[WebRTC] Connection established, client ID:", this.clientId);

    return this.clientId;
  }

  send(data: ArrayBuffer | Uint8Array) {
    if (this.dc?.readyState === "open") {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

      if (bytes.byteLength <= MAX_PAYLOAD_SIZE) {
        this.dc.send(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          )
        );
      } else {
        this.sendFragmented(bytes);
      }
    } else {
      console.warn("[WebRTC] DataChannel not open, dropping message");
    }
  }

  private sendFragmented(data: Uint8Array) {
    if (!this.dc || this.dc.readyState !== "open") return;

    const messageId = this.sendMessageIdCounter;
    this.sendMessageIdCounter = (this.sendMessageIdCounter + 1) & 0xffffffff;

    const totalFragments = Math.ceil(data.byteLength / MAX_PAYLOAD_SIZE);

    for (let i = 0; i < totalFragments; i++) {
      const start = i * MAX_PAYLOAD_SIZE;
      const end = Math.min(start + MAX_PAYLOAD_SIZE, data.byteLength);
      const payload = data.slice(start, end);

      const fragment = new Uint8Array(
        FRAGMENT_HEADER_SIZE + payload.byteLength
      );
      const view = new DataView(fragment.buffer);

      fragment[0] = FRAGMENT_MARKER;
      view.setUint32(1, messageId, false);
      view.setUint16(5, i, false);
      view.setUint16(7, totalFragments, false);
      fragment.set(payload, FRAGMENT_HEADER_SIZE);

      this.dc.send(fragment.buffer);
    }
  }

  close() {
    this.dc?.close();
    this.pc.close();
  }

  get readyState(): RTCDataChannelState | null {
    return this.dc?.readyState ?? null;
  }

  get connected(): boolean {
    return this.dc?.readyState === "open";
  }

  private waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === "complete") {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.log("[WebRTC] ICE gathering timeout, proceeding anyway");
        resolve();
      }, 3000);

      this.pc.onicegatheringstatechange = () => {
        console.log("[WebRTC] ICE gathering state:", this.pc.iceGatheringState);
        if (this.pc.iceGatheringState === "complete") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });
  }

  private handleIncomingMessage(data: ArrayBuffer) {
    const bytes = new Uint8Array(data);

    if (bytes.length >= FRAGMENT_HEADER_SIZE && bytes[0] === FRAGMENT_MARKER) {
      this.handleFragment(bytes);
    } else {
      this.onMessage?.(data);
    }
  }

  private handleFragment(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const messageId = view.getUint32(1, false);
    const fragmentIndex = view.getUint16(5, false);
    const totalFragments = view.getUint16(7, false);
    const payload = bytes.slice(FRAGMENT_HEADER_SIZE);

    let buffer = this.fragmentBuffers.get(messageId);
    if (!buffer) {
      buffer = {
        fragments: new Map(),
        totalFragments,
        receivedCount: 0,
        totalSize: 0,
      };
      this.fragmentBuffers.set(messageId, buffer);
    }

    if (!buffer.fragments.has(fragmentIndex)) {
      buffer.fragments.set(fragmentIndex, payload);
      buffer.receivedCount++;
      buffer.totalSize += payload.length;
    }

    if (buffer.receivedCount === buffer.totalFragments) {
      const reassembled = new Uint8Array(buffer.totalSize);
      let offset = 0;
      for (let i = 0; i < buffer.totalFragments; i++) {
        const fragment = buffer.fragments.get(i);
        if (fragment) {
          reassembled.set(fragment, offset);
          offset += fragment.length;
        }
      }

      this.fragmentBuffers.delete(messageId);
      this.onMessage?.(reassembled.buffer);
    }
  }
}
