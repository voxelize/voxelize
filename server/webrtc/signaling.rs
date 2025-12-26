use std::sync::Arc;

use actix::Addr;
use actix_web::{web, Error, HttpResponse};
use hashbrown::HashMap;
use log::{info, warn};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use webrtc::api::API;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::ice_transport::ice_gathering_state::RTCIceGatheringState;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

use crate::server::{Connect, Disconnect, Server};

use super::datachannel::setup_datachannel_handlers;
use super::peer::WebRTCPeer;

pub type WebRTCPeers = Arc<Mutex<HashMap<String, WebRTCPeer>>>;

fn get_ice_servers() -> Vec<RTCIceServer> {
    let mut servers = vec![
        RTCIceServer {
            urls: vec![
                "stun:stun.l.google.com:19302".to_owned(),
                "stun:stun1.l.google.com:19302".to_owned(),
            ],
            ..Default::default()
        },
    ];

    if let (Ok(turn_url), Ok(turn_username), Ok(turn_credential)) = (
        std::env::var("TURN_URL"),
        std::env::var("TURN_USERNAME"),
        std::env::var("TURN_CREDENTIAL"),
    ) {
        info!("[WebRTC] TURN server configured: {}", turn_url);
        servers.push(RTCIceServer {
            urls: vec![turn_url],
            username: turn_username,
            credential: turn_credential,
            ..Default::default()
        });
    } else {
        warn!("[WebRTC] No TURN server configured. Set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL env vars for better NAT traversal.");
    }

    servers
}

#[derive(Debug, Deserialize)]
pub struct RtcOfferRequest {
    pub client_id: Option<String>,
    pub secret: Option<String>,
    pub sdp: String,
    #[serde(default)]
    pub is_transport: bool,
}

#[derive(Debug, Serialize)]
pub struct RtcOfferResponse {
    pub client_id: String,
    pub sdp: String,
}

#[derive(Debug, Deserialize)]
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
    server: web::Data<Addr<Server>>,
    server_secret: web::Data<Option<String>>,
) -> Result<HttpResponse, Error> {
    if let Some(ref expected_secret) = **server_secret {
        match &body.secret {
            Some(provided_secret) if provided_secret == expected_secret => {}
            _ => {
                warn!("[WebRTC] Invalid or missing secret in RTC offer");
                return Ok(HttpResponse::Forbidden().json(serde_json::json!({
                    "error": "Invalid secret"
                })));
            }
        }
    }

    let client_id = body.client_id.clone().unwrap_or_else(|| nanoid!());

    info!(
        "[WebRTC] Processing offer for client: {} (transport: {})",
        client_id, body.is_transport
    );

    let ice_servers = get_ice_servers();

    let config = RTCConfiguration {
        ice_servers,
        ..Default::default()
    };

    let peer_connection = match api.new_peer_connection(config).await {
        Ok(pc) => Arc::new(pc),
        Err(e) => {
            warn!("[WebRTC] Failed to create peer connection: {:?}", e);
            return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to create peer connection: {:?}", e)
            })));
        }
    };

    let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let registered_id = server
        .send(Connect {
            id: Some(client_id.clone()),
            is_transport: body.is_transport,
            sender: tx.clone(),
        })
        .await
        .map_err(|e| {
            warn!("[WebRTC] Failed to register with server: {:?}", e);
            actix_web::error::ErrorInternalServerError("Failed to register connection")
        })?;

    let rx = Arc::new(Mutex::new(Some(rx)));

    let server_for_dc = server.get_ref().clone();
    let id_for_dc = registered_id.clone();
    let peers_for_dc = peers.clone();
    let rx_for_dc = Arc::clone(&rx);
    peer_connection.on_data_channel(Box::new(move |dc| {
        let server = server_for_dc.clone();
        let id = id_for_dc.clone();
        let peers = peers_for_dc.clone();
        let rx_arc = Arc::clone(&rx_for_dc);

        info!("[WebRTC] Received DataChannel: {}", dc.label());

        Box::pin(async move {
            let rx_opt = {
                let mut lock = rx_arc.lock().await;
                lock.take()
            };

            if let Some(rx) = rx_opt {
                setup_datachannel_handlers(Arc::clone(&dc), id.clone(), server.clone(), rx).await;
            } else {
                warn!("[WebRTC] DataChannel receiver already taken for client {}", id);
            }

            {
                let mut peers_lock = peers.lock().await;
                if let Some(peer) = peers_lock.get_mut(&id) {
                    peer.set_data_channel(dc);
                }
            }
        })
    }));

    let server_clone = server.get_ref().clone();
    let id_clone = registered_id.clone();
    peer_connection.on_peer_connection_state_change(Box::new(move |state| {
        let server = server_clone.clone();
        let id = id_clone.clone();
        info!("[WebRTC] Peer connection state changed to: {:?}", state);

        Box::pin(async move {
            use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
            match state {
                RTCPeerConnectionState::Failed
                | RTCPeerConnectionState::Disconnected
                | RTCPeerConnectionState::Closed => {
                    info!("[WebRTC] Connection closed for client {}", id);
                    server.do_send(Disconnect { id });
                }
                _ => {}
            }
        })
    }));

    let offer = RTCSessionDescription::offer(body.sdp.clone())
        .map_err(|e| actix_web::error::ErrorBadRequest(format!("Invalid SDP offer: {:?}", e)))?;

    peer_connection.set_remote_description(offer).await.map_err(|e| {
        warn!("[WebRTC] Failed to set remote description: {:?}", e);
        actix_web::error::ErrorInternalServerError("Failed to set remote description")
    })?;

    let answer = peer_connection.create_answer(None).await.map_err(|e| {
        warn!("[WebRTC] Failed to create answer: {:?}", e);
        actix_web::error::ErrorInternalServerError("Failed to create answer")
    })?;

    peer_connection
        .set_local_description(answer)
        .await
        .map_err(|e| {
            warn!("[WebRTC] Failed to set local description: {:?}", e);
            actix_web::error::ErrorInternalServerError("Failed to set local description")
        })?;

    let pc_clone = Arc::clone(&peer_connection);
    let gather_complete = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        async {
            loop {
                if pc_clone.ice_gathering_state() == RTCIceGatheringState::Complete {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        },
    )
    .await;

    if gather_complete.is_err() {
        warn!("[WebRTC] ICE gathering timeout, proceeding with available candidates");
    }

    let local_desc = peer_connection.local_description().await.ok_or_else(|| {
        warn!("[WebRTC] No local description available");
        actix_web::error::ErrorInternalServerError("No local description")
    })?;

    let peer = WebRTCPeer::new(
        registered_id.clone(),
        peer_connection,
        tx,
        body.is_transport,
    );

    {
        let mut peers_lock = peers.lock().await;
        peers_lock.insert(registered_id.clone(), peer);
    }

    info!(
        "[WebRTC] Successfully created peer connection for client {}",
        registered_id
    );

    Ok(HttpResponse::Ok().json(RtcOfferResponse {
        client_id: registered_id,
        sdp: local_desc.sdp,
    }))
}

pub async fn rtc_candidate(
    body: web::Json<RtcCandidateRequest>,
    peers: web::Data<WebRTCPeers>,
) -> Result<HttpResponse, Error> {
    let peers_lock = peers.lock().await;

    let peer = match peers_lock.get(&body.client_id) {
        Some(p) => p,
        None => {
            warn!(
                "[WebRTC] Received candidate for unknown client: {}",
                body.client_id
            );
            return Ok(HttpResponse::NotFound().json(serde_json::json!({
                "error": "Client not found"
            })));
        }
    };

    use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;

    let candidate = RTCIceCandidateInit {
        candidate: body.candidate.clone(),
        sdp_mid: body.sdp_mid.clone(),
        sdp_mline_index: body.sdp_mline_index,
        username_fragment: None,
    };

    if let Err(e) = peer.peer_connection.add_ice_candidate(candidate).await {
        warn!(
            "[WebRTC] Failed to add ICE candidate for {}: {:?}",
            body.client_id, e
        );
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({
            "error": format!("Failed to add ICE candidate: {:?}", e)
        })));
    }

    info!(
        "[WebRTC] Added ICE candidate for client {}",
        body.client_id
    );

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true
    })))
}
