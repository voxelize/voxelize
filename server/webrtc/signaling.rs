use std::sync::Arc;

use actix_web::{web, Error, HttpResponse};
use bytes::Bytes;
use log::info;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use webrtc::api::API;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_connection_state::RTCIceConnectionState;
use webrtc::ice_transport::ice_gatherer_state::RTCIceGathererState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

use super::datachannel::{fragment_message, FragmentAssembler};
use crate::{decode_message, ClientMessage, RtcSenders, Server};

use actix::Addr;
use hashbrown::HashMap;

pub type WebRTCPeers = Arc<Mutex<HashMap<String, Arc<RTCPeerConnection>>>>;

#[derive(Deserialize)]
pub struct RtcOfferRequest {
    pub sdp: String,
    pub client_id: String,
}

#[derive(Serialize)]
pub struct RtcOfferResponse {
    pub sdp: String,
}

#[derive(Deserialize)]
pub struct RtcCandidateRequest {
    pub client_id: String,
    pub candidate: String,
    pub sdp_mid: Option<String>,
    pub sdp_mline_index: Option<u16>,
}

pub async fn rtc_offer(
    body: web::Json<RtcOfferRequest>,
    api: web::Data<Arc<API>>,
    peers: web::Data<WebRTCPeers>,
    rtc_senders: web::Data<RtcSenders>,
    server: web::Data<Addr<Server>>,
) -> Result<HttpResponse, Error> {
    let client_id = body.client_id.clone();

    let pc = api
        .new_peer_connection(webrtc::peer_connection::configuration::RTCConfiguration {
            ice_servers: vec![webrtc::ice_transport::ice_server::RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_string()],
                ..Default::default()
            }],
            ..Default::default()
        })
        .await
        .map_err(|e| {
            actix_web::error::ErrorInternalServerError(format!(
                "Failed to create peer connection: {}",
                e
            ))
        })?;

    let pc = Arc::new(pc);
    peers.lock().await.insert(client_id.clone(), pc.clone());

    let (rtc_tx, rtc_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let rtc_senders_clone = rtc_senders.get_ref().clone();
    let client_id_clone = client_id.clone();
    let rtc_tx_clone = rtc_tx.clone();

    let server_clone = server.get_ref().clone();
    let client_id_for_msg = client_id.clone();

    let rtc_rx_opt = Arc::new(Mutex::new(Some(rtc_rx)));

    pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
        let rtc_senders = rtc_senders_clone.clone();
        let client_id = client_id_clone.clone();
        let rtc_tx = rtc_tx_clone.clone();
        let server = server_clone.clone();
        let client_id_msg = client_id_for_msg.clone();
        let rtc_rx_opt = rtc_rx_opt.clone();

        Box::pin(async move {
            info!(
                "[WebRTC] DataChannel '{}' opened for {}",
                dc.label(),
                client_id
            );

            rtc_senders.lock().await.insert(client_id.clone(), rtc_tx);

            if let Some(mut rtc_rx) = rtc_rx_opt.lock().await.take() {
                let dc_send = dc.clone();
                tokio::spawn(async move {
                    while let Some(data) = rtc_rx.recv().await {
                        for fragment in fragment_message(&data) {
                            if dc_send.send(&Bytes::from(fragment)).await.is_err() {
                                break;
                            }
                        }
                    }
                });
            }

            let assembler = Arc::new(Mutex::new(FragmentAssembler::new()));
            dc.on_message(Box::new(move |msg| {
                let server = server.clone();
                let client_id = client_id_msg.clone();
                let assembler = assembler.clone();

                Box::pin(async move {
                    let mut asm = assembler.lock().await;
                    if let Some(complete) = asm.process(&msg.data) {
                        if let Ok(message) = decode_message(&complete) {
                            let _ = server
                                .send(ClientMessage {
                                    id: client_id,
                                    data: message,
                                })
                                .await;
                        }
                    }
                })
            }));
        })
    }));

    let rtc_senders_disconnect = rtc_senders.get_ref().clone();
    let client_id_disconnect = client_id.clone();

    pc.on_ice_connection_state_change(Box::new(move |state: RTCIceConnectionState| {
        let rtc_senders = rtc_senders_disconnect.clone();
        let client_id = client_id_disconnect.clone();

        Box::pin(async move {
            info!("[WebRTC] ICE state for {}: {:?}", client_id, state);
            if matches!(
                state,
                RTCIceConnectionState::Failed
                    | RTCIceConnectionState::Disconnected
                    | RTCIceConnectionState::Closed
            ) {
                rtc_senders.lock().await.remove(&client_id);
            }
        })
    }));

    let offer = RTCSessionDescription::offer(body.sdp.clone())
        .map_err(|e| actix_web::error::ErrorBadRequest(format!("Invalid SDP: {}", e)))?;

    pc.set_remote_description(offer).await.map_err(|e| {
        actix_web::error::ErrorInternalServerError(format!("Failed to set remote SDP: {}", e))
    })?;

    let answer = pc.create_answer(None).await.map_err(|e| {
        actix_web::error::ErrorInternalServerError(format!("Failed to create answer: {}", e))
    })?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);
    let tx = Arc::new(Mutex::new(Some(tx)));

    pc.on_ice_gathering_state_change(Box::new(move |state: RTCIceGathererState| {
        let tx = tx.clone();
        Box::pin(async move {
            if state == RTCIceGathererState::Complete {
                if let Some(tx) = tx.lock().await.take() {
                    let _ = tx.send(()).await;
                }
            }
        })
    }));

    pc.set_local_description(answer).await.map_err(|e| {
        actix_web::error::ErrorInternalServerError(format!("Failed to set local SDP: {}", e))
    })?;

    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv()).await;

    let local_desc = pc.local_description().await.ok_or_else(|| {
        actix_web::error::ErrorInternalServerError("No local description available")
    })?;

    Ok(HttpResponse::Ok().json(RtcOfferResponse {
        sdp: local_desc.sdp,
    }))
}

pub async fn rtc_candidate(
    body: web::Json<RtcCandidateRequest>,
    peers: web::Data<WebRTCPeers>,
) -> Result<HttpResponse, Error> {
    let peers_map = peers.lock().await;

    let pc = peers_map.get(&body.client_id).ok_or_else(|| {
        actix_web::error::ErrorNotFound(format!("No peer for client {}", body.client_id))
    })?;

    let candidate = RTCIceCandidateInit {
        candidate: body.candidate.clone(),
        sdp_mid: body.sdp_mid.clone(),
        sdp_mline_index: body.sdp_mline_index,
        ..Default::default()
    };

    pc.add_ice_candidate(candidate).await.map_err(|e| {
        actix_web::error::ErrorInternalServerError(format!("Failed to add ICE candidate: {}", e))
    })?;

    Ok(HttpResponse::Ok().json(serde_json::json!({"status": "ok"})))
}
