use std::sync::Arc;

use actix::Addr;
use bytes::Bytes;
use log::{info, warn};
use tokio::sync::mpsc;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;

use crate::server::{ClientMessage, Server};
use crate::decode_message;

const MAX_FRAGMENT_SIZE: usize = 15000;
const FRAGMENT_HEADER_SIZE: usize = 9;

fn create_fragment_header(message_id: u32, fragment_index: u16, total_fragments: u16, is_last: bool) -> [u8; FRAGMENT_HEADER_SIZE] {
    let mut header = [0u8; FRAGMENT_HEADER_SIZE];
    header[0] = 0xFF;
    header[1..5].copy_from_slice(&message_id.to_be_bytes());
    header[5..7].copy_from_slice(&fragment_index.to_be_bytes());
    header[7..9].copy_from_slice(&total_fragments.to_be_bytes());
    header
}

fn fragment_message(message_id: u32, data: &[u8]) -> Vec<Vec<u8>> {
    let payload_size = MAX_FRAGMENT_SIZE - FRAGMENT_HEADER_SIZE;
    let total_fragments = ((data.len() + payload_size - 1) / payload_size) as u16;
    
    let mut fragments = Vec::with_capacity(total_fragments as usize);
    
    for (i, chunk) in data.chunks(payload_size).enumerate() {
        let is_last = i as u16 == total_fragments - 1;
        let header = create_fragment_header(message_id, i as u16, total_fragments, is_last);
        
        let mut fragment = Vec::with_capacity(FRAGMENT_HEADER_SIZE + chunk.len());
        fragment.extend_from_slice(&header);
        fragment.extend_from_slice(chunk);
        fragments.push(fragment);
    }
    
    fragments
}

pub async fn setup_datachannel_handlers(
    dc: Arc<RTCDataChannel>,
    client_id: String,
    server_addr: Addr<Server>,
    mut rx: mpsc::UnboundedReceiver<Vec<u8>>,
) {
    let dc_send = Arc::clone(&dc);
    let client_id_for_send = client_id.clone();

    tokio::spawn(async move {
        let mut message_id_counter: u32 = 0;
        
        while let Some(bytes) = rx.recv().await {
            if bytes.len() <= MAX_FRAGMENT_SIZE - FRAGMENT_HEADER_SIZE {
                if let Err(e) = dc_send.send(&Bytes::from(bytes)).await {
                    warn!("[WebRTC] Failed to send via DataChannel for {}: {:?}", client_id_for_send, e);
                    break;
                }
            } else {
                let fragments = fragment_message(message_id_counter, &bytes);
                message_id_counter = message_id_counter.wrapping_add(1);
                
                for (i, fragment) in fragments.iter().enumerate() {
                    if let Err(e) = dc_send.send(&Bytes::from(fragment.clone())).await {
                        warn!("[WebRTC] Failed to send fragment {} for {}: {:?}", i, client_id_for_send, e);
                        break;
                    }
                }
            }
        }
        info!("[WebRTC] Send loop ended for client {}", client_id_for_send);
    });

    let client_id_for_recv = client_id.clone();
    dc.on_message(Box::new(move |msg: DataChannelMessage| {
        let bytes = msg.data.to_vec();
        let server = server_addr.clone();
        let id = client_id_for_recv.clone();

        Box::pin(async move {
            match decode_message(&bytes) {
                Ok(message) => {
                    if let Err(e) = server
                        .send(ClientMessage {
                            id: id.clone(),
                            data: message,
                        })
                        .await
                    {
                        warn!("[WebRTC] Failed to send to server actor: {:?}", e);
                    }
                }
                Err(e) => {
                    warn!("[WebRTC] Failed to decode message from {}: {:?}", id, e);
                }
            }
        })
    }));

    dc.on_open(Box::new(move || {
        info!("[WebRTC] DataChannel opened for client {}", client_id);
        Box::pin(async {})
    }));
}
