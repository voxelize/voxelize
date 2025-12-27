const FRAGMENT_HEADER_SIZE = 9;

export class WebRTCConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private fragments = new Map<number, Map<number, Uint8Array>>();
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
    baseUrl.protocol = baseUrl.protocol.replace(/^ws/, "http");

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
    const view = new DataView(data);

    if (data.byteLength < 1) {
      return;
    }

    const isFragment = view.getUint8(0) === 1;

    if (!isFragment) {
      this.onMessage?.(data);
      return;
    }

    if (data.byteLength < FRAGMENT_HEADER_SIZE) {
      return;
    }

    const total = view.getUint32(1, true);
    const index = view.getUint32(5, true);
    const payload = new Uint8Array(data.slice(FRAGMENT_HEADER_SIZE));

    const messageId =
      index === 0 ? this.nextMessageId++ : this.nextMessageId - 1;

    let fragmentMap = this.fragments.get(messageId);
    if (!fragmentMap) {
      fragmentMap = new Map();
      this.fragments.set(messageId, fragmentMap);
    }
    fragmentMap.set(index, payload);

    if (fragmentMap.size === total) {
      let totalLength = 0;
      for (let i = 0; i < total; i++) {
        const frag = fragmentMap.get(i);
        if (!frag) {
          this.fragments.delete(messageId);
          return;
        }
        totalLength += frag.byteLength;
      }

      const complete = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < total; i++) {
        const frag = fragmentMap.get(i);
        if (frag) {
          complete.set(frag, offset);
          offset += frag.byteLength;
        }
      }

      this.fragments.delete(messageId);
      this.onMessage?.(complete.buffer);
    }
  }
}
