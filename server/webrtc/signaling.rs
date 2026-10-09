use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

use actix_web::{web, Error, HttpResponse};
use bytes::Bytes;
use log::{info, warn};
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
use crate::{
    decode_message, ClientMessage, RtcSenders, Server, SessionAuth, VoxelizeHandle, CLIENT_ID_PARAM,
};

use actix::Addr;
use hashbrown::HashMap;

pub type WebRTCPeers = Arc<Mutex<HashMap<String, Arc<RTCPeerConnection>>>>;

/// Query-style parameter name for the session ticket, shared with the `/ws/`
/// upgrade so one authenticator serves both lanes.
pub const SESSION_TICKET_PARAM: &str = "ticket";

/// How long a peer connection may take to open its data channel. A browser
/// whose ICE never finds a candidate pair leaves this side checking forever,
/// logging every 200 ms; past this the connection is closed and the client
/// keeps using its WebSocket.
const DATA_CHANNEL_OPEN_DEADLINE: Duration = Duration::from_secs(30);

/// Drop `client_id`'s sender if it is still the one feeding `tx`'s channel.
/// A connection that fails after the client has opened a newer one must not
/// take the newer one's sender with it.
async fn forget_sender(
    rtc_senders: &RtcSenders,
    client_id: &str,
    tx: &mpsc::UnboundedSender<Vec<u8>>,
) {
    let mut senders = rtc_senders.lock().await;
    if senders
        .get(client_id)
        .is_some_and(|sender| sender.same_channel(tx))
    {
        senders.remove(client_id);
    }
}

/// Drop `client_id`'s entry if it is still `pc`, for the same reason.
async fn forget_peer(peers: &WebRTCPeers, client_id: &str, pc: &Arc<RTCPeerConnection>) {
    let mut peers = peers.lock().await;
    if peers
        .get(client_id)
        .is_some_and(|current| Arc::ptr_eq(current, pc))
    {
        peers.remove(client_id);
    }
}

/// Close a connection whose data channel never opened. Returns whether it
/// was closed.
async fn close_if_never_opened(
    peers: &WebRTCPeers,
    client_id: &str,
    pc: &Weak<RTCPeerConnection>,
    opened: &AtomicBool,
) -> bool {
    if opened.load(Ordering::Acquire) {
        return false;
    }
    let Some(pc) = pc.upgrade() else {
        return false;
    };
    warn!(
        "[WebRTC] {} never opened its data channel within {:?}; closing the connection",
        client_id, DATA_CHANNEL_OPEN_DEADLINE
    );
    forget_peer(peers, client_id, &pc).await;
    let _ = pc.close().await;
    true
}

#[derive(Deserialize)]
pub struct RtcOfferRequest {
    pub sdp: String,
    pub client_id: String,
    /// The same credential the WebSocket upgrade carries as `?ticket=`. The
    /// data channel delivers messages attributed to `client_id` with no
    /// per-socket token, so the offer must prove that identity the same way
    /// the socket did.
    #[serde(default)]
    pub ticket: Option<String>,
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
    handle: web::Data<VoxelizeHandle>,
) -> Result<HttpResponse, Error> {
    // The data channel is a second inbound lane for an existing session, and
    // every message on it is attributed to `client_id`. Resolve that id
    // through the same authenticator as the socket: with a ticket installed
    // the caller acts as the ticket's identity, never as the id it typed.
    let mut params: HashMap<String, String> = HashMap::new();
    params.insert(CLIENT_ID_PARAM.to_owned(), body.client_id.clone());
    if let Some(ticket) = &body.ticket {
        params.insert(SESSION_TICKET_PARAM.to_owned(), ticket.clone());
    }
    let client_id = match handle.authenticate(&params) {
        SessionAuth::Accept(identity) => match identity.id {
            Some(id) => id,
            None => {
                return Err(actix_web::error::ErrorUnauthorized(
                    "WebRTC offers require an established session identity",
                ));
            }
        },
        SessionAuth::Reject(reason) => {
            log::warn!("[WebRTC] Rejected offer: {}", reason);
            return Err(actix_web::error::ErrorUnauthorized(reason));
        }
    };

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
    // A client offers again after every reconnect, and the connection it
    // offered before is dead to it. Left open, that one kept checking ICE on
    // this side for as long as the server ran, one more per reconnect.
    let replaced = peers.lock().await.insert(client_id.clone(), pc.clone());
    if let Some(replaced) = replaced {
        let _ = replaced.close().await;
    }

    let (rtc_tx, rtc_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let opened = Arc::new(AtomicBool::new(false));

    let rtc_senders_clone = rtc_senders.get_ref().clone();
    let client_id_clone = client_id.clone();
    let rtc_tx_clone = rtc_tx.clone();
    let opened_clone = opened.clone();

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
        let opened = opened_clone.clone();

        Box::pin(async move {
            info!(
                "[WebRTC] DataChannel '{}' opened for {}",
                dc.label(),
                client_id
            );

            opened.store(true, Ordering::Release);
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
                                .send(ClientMessage::new(client_id, message, complete.len(), None))
                                .await;
                        }
                    }
                })
            }));
        })
    }));

    let rtc_senders_disconnect = rtc_senders.get_ref().clone();
    let peers_disconnect = peers.get_ref().clone();
    let client_id_disconnect = client_id.clone();
    // Weak: the connection owns this callback, which must not own it back.
    let pc_disconnect = Arc::downgrade(&pc);

    pc.on_ice_connection_state_change(Box::new(move |state: RTCIceConnectionState| {
        let rtc_senders = rtc_senders_disconnect.clone();
        let peers = peers_disconnect.clone();
        let client_id = client_id_disconnect.clone();
        let rtc_tx = rtc_tx.clone();
        let pc = pc_disconnect.clone();

        Box::pin(async move {
            info!("[WebRTC] ICE state for {}: {:?}", client_id, state);
            if matches!(
                state,
                RTCIceConnectionState::Failed
                    | RTCIceConnectionState::Disconnected
                    | RTCIceConnectionState::Closed
            ) {
                forget_sender(&rtc_senders, &client_id, &rtc_tx).await;
            }
            if matches!(
                state,
                RTCIceConnectionState::Failed | RTCIceConnectionState::Closed
            ) {
                if let Some(pc) = pc.upgrade() {
                    forget_peer(&peers, &client_id, &pc).await;
                    if state == RTCIceConnectionState::Failed {
                        let _ = pc.close().await;
                    }
                }
            }
        })
    }));

    let peers_deadline = peers.get_ref().clone();
    let client_id_deadline = client_id.clone();
    let pc_deadline = Arc::downgrade(&pc);
    tokio::spawn(async move {
        tokio::time::sleep(DATA_CHANNEL_OPEN_DEADLINE).await;
        close_if_never_opened(&peers_deadline, &client_id_deadline, &pc_deadline, &opened).await;
    });

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

#[cfg(test)]
mod tests {
    use actix::Actor;
    use actix_web::{test, App};
    use webrtc::api::APIBuilder;
    use webrtc::peer_connection::configuration::RTCConfiguration;
    use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;

    use super::*;
    use crate::{create_rtc_senders, create_webrtc_api};

    /// A browser-side connection and the offer it would send.
    async fn client_offer() -> (Arc<RTCPeerConnection>, String) {
        let api = APIBuilder::new().build();
        let pc = Arc::new(
            api.new_peer_connection(RTCConfiguration::default())
                .await
                .unwrap(),
        );
        pc.create_data_channel("voxelize", None).await.unwrap();
        let offer = pc.create_offer(None).await.unwrap();
        let mut gathered = pc.gathering_complete_promise().await;
        pc.set_local_description(offer).await.unwrap();
        let _ = gathered.recv().await;
        let sdp = pc.local_description().await.unwrap().sdp;
        (pc, sdp)
    }

    #[actix_web::test]
    async fn a_new_offer_closes_the_connection_it_replaces() {
        let handle = VoxelizeHandle::new(Server::new().debug(false).build().start());
        let peers: WebRTCPeers = Arc::new(Mutex::new(HashMap::new()));
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(create_webrtc_api()))
                .app_data(web::Data::new(peers.clone()))
                .app_data(web::Data::new(create_rtc_senders()))
                .configure(handle.configure())
                .route("/rtc/offer", web::post().to(rtc_offer)),
        )
        .await;

        let mut connections = vec![];
        for _ in 0..2 {
            let (client, sdp) = client_offer().await;
            let response = test::call_service(
                &app,
                test::TestRequest::post()
                    .uri("/rtc/offer")
                    .set_json(serde_json::json!({ "sdp": sdp, "client_id": "rejoiner" }))
                    .to_request(),
            )
            .await;
            assert!(
                response.status().is_success(),
                "offer refused: {:?}",
                response.status()
            );
            connections.push((client, peers.lock().await.get("rejoiner").cloned().unwrap()));
        }

        let (first, second) = (&connections[0].1, &connections[1].1);
        assert!(!Arc::ptr_eq(first, second));
        assert_eq!(
            first.connection_state(),
            RTCPeerConnectionState::Closed,
            "the connection a reconnect replaced was left open"
        );
        assert_ne!(second.connection_state(), RTCPeerConnectionState::Closed);
    }

    #[tokio::test]
    async fn a_failing_connection_drops_only_its_own_sender() {
        let senders = create_rtc_senders();
        let (old_tx, _old_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (new_tx, _new_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        senders
            .lock()
            .await
            .insert("client".to_owned(), new_tx.clone());

        forget_sender(&senders, "client", &old_tx).await;
        assert!(senders.lock().await.contains_key("client"));

        forget_sender(&senders, "client", &new_tx).await;
        assert!(!senders.lock().await.contains_key("client"));
    }

    #[tokio::test]
    async fn a_connection_whose_data_channel_never_opened_is_closed() {
        let api = create_webrtc_api();
        let peers: WebRTCPeers = Arc::new(Mutex::new(HashMap::new()));
        let pc = Arc::new(
            api.new_peer_connection(RTCConfiguration::default())
                .await
                .unwrap(),
        );
        peers.lock().await.insert("silent".to_owned(), pc.clone());

        let opened = AtomicBool::new(true);
        assert!(!close_if_never_opened(&peers, "silent", &Arc::downgrade(&pc), &opened).await);
        assert_ne!(pc.connection_state(), RTCPeerConnectionState::Closed);

        let opened = AtomicBool::new(false);
        assert!(close_if_never_opened(&peers, "silent", &Arc::downgrade(&pc), &opened).await);
        assert_eq!(pc.connection_state(), RTCPeerConnectionState::Closed);
        assert!(!peers.lock().await.contains_key("silent"));
    }
}
