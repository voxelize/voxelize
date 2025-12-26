use std::sync::Arc;
use tokio::sync::mpsc;
use webrtc::data_channel::RTCDataChannel;
use webrtc::peer_connection::RTCPeerConnection;

pub type WebRTCSender = mpsc::UnboundedSender<Vec<u8>>;

pub struct WebRTCPeer {
    pub id: String,
    pub peer_connection: Arc<RTCPeerConnection>,
    pub data_channel: Option<Arc<RTCDataChannel>>,
    pub sender: WebRTCSender,
    pub is_transport: bool,
}

impl WebRTCPeer {
    pub fn new(
        id: String,
        peer_connection: Arc<RTCPeerConnection>,
        sender: WebRTCSender,
        is_transport: bool,
    ) -> Self {
        Self {
            id,
            peer_connection,
            data_channel: None,
            sender,
            is_transport,
        }
    }

    pub fn set_data_channel(&mut self, dc: Arc<RTCDataChannel>) {
        self.data_channel = Some(dc);
    }
}
