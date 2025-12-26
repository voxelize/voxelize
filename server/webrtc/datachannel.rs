use std::collections::HashMap;
use std::sync::Arc;

use actix::Addr;
use bytes::Bytes;
use log::{info, warn};
use tokio::sync::{mpsc, Mutex};
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;

use crate::server::{ClientMessage, Server};
use crate::decode_message;

const MAX_FRAGMENT_SIZE: usize = 16000;
const FRAGMENT_HEADER_SIZE: usize = 9;
const FRAGMENT_MARKER: u8 = 0xFF;

struct FragmentBuffer {
    fragments: HashMap<u16, Vec<u8>>,
    total_fragments: u16,
    total_size: usize,
}

fn is_fragment(data: &[u8]) -> bool {
    data.len() >= FRAGMENT_HEADER_SIZE && data[0] == FRAGMENT_MARKER
}

fn parse_fragment_header(data: &[u8]) -> (u32, u16, u16) {
    let message_id = u32::from_be_bytes([data[1], data[2], data[3], data[4]]);
    let fragment_index = u16::from_be_bytes([data[5], data[6]]);
    let total_fragments = u16::from_be_bytes([data[7], data[8]]);
    (message_id, fragment_index, total_fragments)
}

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
    let fragment_buffers: Arc<Mutex<HashMap<u32, FragmentBuffer>>> =
        Arc::new(Mutex::new(HashMap::new()));

    dc.on_message(Box::new(move |msg: DataChannelMessage| {
        let bytes = msg.data.to_vec();
        let server = server_addr.clone();
        let id = client_id_for_recv.clone();
        let buffers = Arc::clone(&fragment_buffers);

        Box::pin(async move {
            let final_bytes = if is_fragment(&bytes) {
                let (message_id, fragment_index, total_fragments) = parse_fragment_header(&bytes);
                let payload = bytes[FRAGMENT_HEADER_SIZE..].to_vec();

                let mut buffers_guard = buffers.lock().await;
                let buffer = buffers_guard.entry(message_id).or_insert_with(|| FragmentBuffer {
                    fragments: HashMap::new(),
                    total_fragments,
                    total_size: 0,
                });

                if !buffer.fragments.contains_key(&fragment_index) {
                    buffer.total_size += payload.len();
                    buffer.fragments.insert(fragment_index, payload);
                }

                if buffer.fragments.len() as u16 == buffer.total_fragments {
                    let mut reassembled = Vec::with_capacity(buffer.total_size);
                    for i in 0..buffer.total_fragments {
                        if let Some(fragment) = buffer.fragments.get(&i) {
                            reassembled.extend_from_slice(fragment);
                        }
                    }
                    buffers_guard.remove(&message_id);
                    Some(reassembled)
                } else {
                    None
                }
            } else {
                Some(bytes)
            };

            if let Some(data) = final_bytes {
                match decode_message(&data) {
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
            }
        })
    }));

    dc.on_open(Box::new(move || {
        info!("[WebRTC] DataChannel opened for client {}", client_id);
        Box::pin(async {})
    }));
}
