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
      ordered: true,
      maxRetransmits: 3,
    });
    this.dc.binaryType = "arraybuffer";

    this.dc.onopen = () => {
      console.log(
        "[WebRTC] DataChannel opened, readyState:",
        this.dc?.readyState
      );
      this.onOpen?.();
    };

    this.dc.onclose = () => {
      console.log("[WebRTC] DataChannel closed");
      this.onClose?.();
    };

    this.dc.onerror = (event) => {
      console.error("[WebRTC] DataChannel error:", event);
    };

    this.dc.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data as ArrayBuffer);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(
        "[WebRTC] ICE connection state:",
        this.pc?.iceConnectionState
      );
    };

    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", this.pc?.connectionState);
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const httpUrl = serverUrl
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/+$/, "");
    console.log("[WebRTC] Sending offer to:", `${httpUrl}/rtc/offer`);

    const response = await fetch(`${httpUrl}/rtc/offer`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sdp: offer.sdp,
        client_id: clientId,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`RTC offer failed: ${response.status} - ${text}`);
    }

    const { sdp: answerSdp } = await response.json();
    console.log("[WebRTC] Received answer SDP");

    await this.pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });
    console.log("[WebRTC] Remote description set, waiting for ICE...");
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
