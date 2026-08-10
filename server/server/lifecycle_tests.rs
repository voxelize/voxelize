use super::*;
use crate::world::{WorldConfig, PROTOCOL_MISMATCH_REASON};
use crate::{decode_message, GetWorldStats};

const WORLD: &str = "lifeworld";

fn join_message(world: &str) -> Message {
    Message::new(&MessageType::Join)
        .json(&json!({ "world": world, "username": "tester" }).to_string())
        .build()
}

/// Fake connection: returns the sender and its control-lane receiver.
/// Session lifecycle traffic (INIT, ERROR, JOIN/LEAVE) rides the control
/// lane; these tests never exercise the bulk lane, so its receiver is
/// dropped and bulk sends would error harmlessly.
fn fake_socket() -> (WsSender, mpsc::UnboundedReceiver<Vec<u8>>) {
    let (control_tx, control_rx) = mpsc::unbounded_channel();
    let (bulk_tx, _) = mpsc::unbounded_channel();
    (WsSender::new(control_tx, bulk_tx), control_rx)
}

/// Await the world's mailbox draining (SyncArbiter processes messages
/// FIFO on one thread, so a round-trip proves prior do_sends ran) and
/// return the world's live client count.
async fn world_client_count(server: &Server) -> usize {
    server
        .worlds
        .get(WORLD)
        .unwrap()
        .send(GetWorldStats)
        .await
        .unwrap()
        .client_count
}

/// Drain everything on a fake socket's control lane, marking each message
/// written so the sender's depth (the state-flush gate signal) reflects a
/// live socket. Messages above the encoder's compression threshold arrive
/// LZ4-frame-compressed (an INIT carrying a real block registry crosses it),
/// so decode falls back to decompression exactly like a live client's decode
/// worker. Payloads that survive neither path (test filler) are skipped.
fn drain_messages(sender: &WsSender, rx: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> Vec<Message> {
    let mut messages = vec![];
    while let Ok(bytes) = rx.try_recv() {
        sender.mark_control_written();
        if let Ok(message) = decode_message(&bytes) {
            messages.push(message);
            continue;
        }
        let mut decoder = lz4_flex::frame::FrameDecoder::new(&bytes[..]);
        let mut decompressed = Vec::new();
        if std::io::Read::read_to_end(&mut decoder, &mut decompressed).is_ok() {
            if let Ok(message) = decode_message(&decompressed) {
                messages.push(message);
            }
        }
    }
    messages
}

fn drain_message_types(sender: &WsSender, rx: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> Vec<i32> {
    drain_messages(sender, rx)
        .into_iter()
        .map(|message| message.r#type)
        .collect()
}

/// All peer ids mentioned across PEER messages in a drained batch.
fn peer_ids_in(messages: &[Message]) -> Vec<String> {
    messages
        .iter()
        .filter(|m| m.r#type == MessageType::Peer as i32)
        .flat_map(|m| m.peers.iter().map(|p| p.id.clone()))
        .collect()
}

fn build_server_with_world() -> Server {
    let mut server = Server::new().debug(false).build();
    let config = WorldConfig::new().build();
    server
        .add_world(World::new(WORLD, &config))
        .expect("world should register");
    server
}

fn on_request(server: &mut Server, id: &str, token: &str, data: Message) -> Option<String> {
    server.on_request(id, data, None, 0, Some(token))
}

const DET_WORLD: &str = "detworld";

fn join_message_with_protocol(world: &str, protocol: Option<u32>) -> Message {
    let mut body = json!({ "world": world, "username": "tester" });
    if let Some(protocol) = protocol {
        body["protocol"] = json!(protocol);
    }
    Message::new(&MessageType::Join)
        .json(&body.to_string())
        .build()
}

fn build_server_with_deterministic_world() -> Server {
    let mut server = Server::new().debug(false).build();
    let config = WorldConfig::new()
        .fixed_timestep(Some(crate::FixedStepConfig {
            hz: 60,
            max_catchup_steps: 5,
            seed: 42,
        }))
        .build();
    server
        .add_world(World::new(DET_WORLD, &config))
        .expect("deterministic world should register");
    server
}

#[test]
fn deterministic_world_rejects_missing_protocol_and_closes_terminal() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_deterministic_world();
        let (sender, _rx) = fake_socket();
        let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

        // No protocol field: strict-equality reject, no missing bypass.
        let rejected = on_request(
            &mut server,
            &id,
            &token,
            join_message_with_protocol(DET_WORLD, None),
        );
        assert!(rejected.is_some(), "missing protocol must be rejected");
        assert!(rejected.unwrap().starts_with(PROTOCOL_MISMATCH_REASON));
        assert_eq!(
            sender.requested_close(),
            Some(PROTOCOL_MISMATCH_CLOSE_CODE),
            "reject must request the terminal close code"
        );
        assert_eq!(world_client_count_of(&server, DET_WORLD).await, 0);
    });
}

#[test]
fn deterministic_world_rejects_wrong_protocol() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_deterministic_world();
        let (sender, _rx) = fake_socket();
        let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

        let rejected = on_request(
            &mut server,
            &id,
            &token,
            join_message_with_protocol(DET_WORLD, Some(PROTOCOL_VERSION + 1)),
        );
        assert!(rejected.is_some(), "wrong protocol must be rejected");
        assert_eq!(sender.requested_close(), Some(PROTOCOL_MISMATCH_CLOSE_CODE));
    });
}

#[test]
fn deterministic_world_accepts_exact_protocol() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_deterministic_world();
        let (sender, _rx) = fake_socket();
        let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

        assert_eq!(
            on_request(
                &mut server,
                &id,
                &token,
                join_message_with_protocol(DET_WORLD, Some(PROTOCOL_VERSION)),
            ),
            None,
            "an exactly-matching protocol must join"
        );
        assert_eq!(sender.requested_close(), None);
        assert_eq!(world_client_count_of(&server, DET_WORLD).await, 1);
    });
}

#[test]
fn non_deterministic_world_ignores_protocol() {
    // Existing Town clients send no protocol field; a non-deterministic
    // world must accept them exactly as before (opt-in only).
    actix::System::new().block_on(async {
        let mut server = build_server_with_world();
        let (sender, _rx) = fake_socket();
        let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

        assert_eq!(
            on_request(
                &mut server,
                &id,
                &token,
                join_message_with_protocol(WORLD, None),
            ),
            None,
            "a normal world must not enforce the protocol assert"
        );
        assert_eq!(sender.requested_close(), None);
        assert_eq!(world_client_count(&server).await, 1);
    });
}

async fn world_client_count_of(server: &Server, world: &str) -> usize {
    server
        .worlds
        .get(world)
        .unwrap()
        .send(GetWorldStats)
        .await
        .unwrap()
        .client_count
}

#[test]
fn duplicate_join_replays_ack_without_error_or_duplicate_entity() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_world();
        let (sender, mut rx) = fake_socket();
        let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

        // First JOIN, then a retry as if the INIT ack was lost in flight.
        assert_eq!(
            on_request(&mut server, &id, &token, join_message(WORLD)),
            None
        );
        assert_eq!(
            on_request(&mut server, &id, &token, join_message(WORLD)),
            None,
            "JOIN retry from the live session must not be a fatal error"
        );

        assert_eq!(world_client_count(&server).await, 1, "no duplicate entity");

        let types = drain_message_types(&sender, &mut rx);
        let inits = types
            .iter()
            .filter(|t| **t == MessageType::Init as i32)
            .count();
        assert_eq!(inits, 2, "each JOIN gets an INIT ack (original + replay)");
    });
}

#[test]
fn abrupt_disconnect_then_same_id_reconnect_joins_cleanly() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_world();

        let (old_sender, _old_rx) = fake_socket();
        let (id, old_token) =
            server.register_session(Some("bot".into()), false, old_sender.clone());
        assert_eq!(
            on_request(&mut server, &id, &old_token, join_message(WORLD)),
            None
        );
        assert_eq!(world_client_count(&server).await, 1);

        // Abrupt closure: no Leave, no Disconnect — the process died. A
        // fresh connection with the same id must replace the membership.
        let (new_sender, mut new_rx) = fake_socket();
        let (_, new_token) = server.register_session(Some("bot".into()), false, new_sender.clone());
        assert_eq!(
            on_request(&mut server, &id, &new_token, join_message(WORLD)),
            None,
            "reconnect join must not report 'already in world'"
        );

        assert_eq!(
            world_client_count(&server).await,
            1,
            "exactly one live entity"
        );
        let types = drain_message_types(&new_sender, &mut new_rx);
        assert!(
            types.contains(&(MessageType::Init as i32)),
            "new session receives the INIT ack"
        );

        // The old socket's late disconnect must not tear down the new
        // session (token mismatch).
        server.unregister_session(&id, &old_token);
        assert_eq!(world_client_count(&server).await, 1);
        assert!(server.connections.contains_key(&id));
    });
}

#[test]
fn superseded_socket_is_rejected_and_cannot_cross_wire_sessions() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_world();

        let (old_sender, mut old_rx) = fake_socket();
        let (id, old_token) =
            server.register_session(Some("bot".into()), false, old_sender.clone());
        assert_eq!(
            on_request(&mut server, &id, &old_token, join_message(WORLD)),
            None
        );

        // New socket connects while the old one is still open.
        let (new_sender, _new_rx) = fake_socket();
        let (_, new_token) = server.register_session(Some("bot".into()), false, new_sender.clone());

        // Old socket was kicked with a reliable ERROR message.
        let old_types = drain_message_types(&old_sender, &mut old_rx);
        assert!(old_types.contains(&(MessageType::Error as i32)));

        // The old socket's JOIN retry races the new socket's JOIN: it
        // must be rejected, not steal the new session's registration.
        let error = on_request(&mut server, &id, &old_token, join_message(WORLD));
        assert!(error.is_some(), "superseded socket must be rejected");

        assert_eq!(
            on_request(&mut server, &id, &new_token, join_message(WORLD)),
            None
        );
        assert_eq!(world_client_count(&server).await, 1);
    });
}

#[test]
fn disconnect_removes_membership_deterministically_and_rejoin_works() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_world();

        let (sender, _rx) = fake_socket();
        let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());
        assert_eq!(
            on_request(&mut server, &id, &token, join_message(WORLD)),
            None
        );
        assert_eq!(world_client_count(&server).await, 1);

        server.unregister_session(&id, &token);
        assert_eq!(world_client_count(&server).await, 0, "membership removed");
        assert!(!server.connections.contains_key(&id));
        assert!(!server.lost_sessions.contains_key(&id));

        // A later reconnect with the same id starts a clean session.
        let (sender, mut rx) = fake_socket();
        let (_, token) = server.register_session(Some("bot".into()), false, sender.clone());
        assert_eq!(
            on_request(&mut server, &id, &token, join_message(WORLD)),
            None
        );
        assert_eq!(world_client_count(&server).await, 1);
        assert!(drain_message_types(&sender, &mut rx).contains(&(MessageType::Init as i32)));
    });
}

#[test]
fn join_for_unknown_world_is_rejected_without_touching_session() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_world();

        let (sender, _rx) = fake_socket();
        let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

        let error = on_request(&mut server, &id, &token, join_message("nowhere"));
        assert!(error.is_some());
        // The session registration survives, so a corrected JOIN works.
        assert!(server.lost_sessions.contains_key(&id));
        assert_eq!(
            on_request(&mut server, &id, &token, join_message(WORLD)),
            None
        );
        assert_eq!(world_client_count(&server).await, 1);
    });
}

#[test]
fn peer_visibility_is_bidirectional_and_lifecycle_survives_backlog() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_world();
        let world_addr = server.worlds.get(WORLD).unwrap().clone();
        let tick = |n: usize| {
            let world_addr = world_addr.clone();
            async move {
                for _ in 0..n {
                    world_addr.send(crate::Tick).await.unwrap();
                }
            }
        };

        // A joins first and settles (its metadata dirty flag is long
        // consumed by the time B joins).
        let (sender_a, mut rx_a) = fake_socket();
        let (id_a, token_a) = server.register_session(Some("visA".into()), false, sender_a.clone());
        assert_eq!(
            on_request(&mut server, &id_a, &token_a, join_message(WORLD)),
            None
        );
        tick(4).await;
        drain_messages(&sender_a, &mut rx_a);

        // B joins later.
        let (sender_b, mut rx_b) = fake_socket();
        let (id_b, token_b) = server.register_session(Some("visB".into()), false, sender_b.clone());
        assert_eq!(
            on_request(&mut server, &id_b, &token_b, join_message(WORLD)),
            None
        );
        tick(4).await;

        // A must learn about B: reliable JOIN exactly once + peer state.
        let a_messages = drain_messages(&sender_a, &mut rx_a);
        let joins_for_b = a_messages
            .iter()
            .filter(|m| m.r#type == MessageType::Join as i32 && m.text == id_b)
            .count();
        assert_eq!(
            joins_for_b, 1,
            "existing client gets exactly one JOIN for newcomer"
        );
        let a_peer_ids = peer_ids_in(&a_messages);
        assert!(
            a_peer_ids.contains(&id_b),
            "existing client receives newcomer's peer state"
        );
        assert!(!a_peer_ids.contains(&id_a), "no self peer echo");

        // B must learn about A: INIT peers + full state re-sync.
        let b_messages = drain_messages(&sender_b, &mut rx_b);
        let init = b_messages
            .iter()
            .find(|m| m.r#type == MessageType::Init as i32)
            .expect("newcomer receives INIT");
        assert!(
            init.peers.iter().any(|p| p.id == id_a),
            "newcomer INIT lists existing peers"
        );
        assert!(
            peer_ids_in(&b_messages).contains(&id_a),
            "newcomer receives existing peers' state"
        );

        // B moves; A converges to B's latest position.
        let move_b = Message::new(&MessageType::Peer)
            .peers(&[crate::PeerProtocol {
                id: String::new(),
                username: "visB".into(),
                metadata: json!({ "position": [5.0, 0.0, 0.0] }).to_string(),
            }])
            .build();
        assert_eq!(
            server.on_request(&id_b, move_b, None, 0, Some(&token_b)),
            None
        );
        tick(4).await;
        let a_messages = drain_messages(&sender_a, &mut rx_a);
        let b_position = a_messages
            .iter()
            .filter(|m| m.r#type == MessageType::Peer as i32)
            .flat_map(|m| m.peers.iter())
            .filter(|p| p.id == id_b)
            .filter_map(|p| {
                serde_json::from_str::<Value>(&p.metadata)
                    .ok()?
                    .get("position")?
                    .get(0)?
                    .as_f64()
            })
            .last();
        assert_eq!(b_position, Some(5.0), "A receives B's latest position");

        // Backlog A's socket (undrained control lane past the gate), then
        // have B move and leave. Reliable lifecycle must not be starved:
        // the LEAVE arrives even though state flushing is gated, and no
        // stale state for B is delivered after it.
        for _ in 0..(crate::STATE_FLUSH_MAX_SOCKET_BACKLOG * 2) {
            let _ = sender_a.send(vec![0]);
        }
        let move_b = Message::new(&MessageType::Peer)
            .peers(&[crate::PeerProtocol {
                id: String::new(),
                username: "visB".into(),
                metadata: json!({ "position": [8.0, 0.0, 0.0] }).to_string(),
            }])
            .build();
        assert_eq!(
            server.on_request(&id_b, move_b, None, 0, Some(&token_b)),
            None
        );
        tick(2).await;
        let leave_b = Message::new(&MessageType::Leave).text(WORLD).build();
        assert_eq!(
            server.on_request(&id_b, leave_b, None, 0, Some(&token_b)),
            None
        );
        tick(4).await;

        let a_messages = drain_messages(&sender_a, &mut rx_a);
        let leave_index = a_messages
            .iter()
            .position(|m| m.r#type == MessageType::Leave as i32 && m.text == id_b);
        assert!(
            leave_index.is_some(),
            "backlogged client still receives the reliable LEAVE"
        );
        let peers_after_leave = a_messages[leave_index.unwrap()..]
            .iter()
            .filter(|m| m.r#type == MessageType::Peer as i32)
            .flat_map(|m| m.peers.iter())
            .any(|p| p.id == id_b);
        assert!(
            !peers_after_leave,
            "no stale peer state is delivered after the LEAVE"
        );
        assert_eq!(world_client_count(&server).await, 1, "B removed from world");
    });
}

#[test]
fn malformed_join_payload_is_a_typed_error_not_a_panic() {
    actix::System::new().block_on(async {
        let mut server = build_server_with_world();

        let (sender, _rx) = fake_socket();
        let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

        let message = Message::new(&MessageType::Join).json("{not json").build();
        let error = on_request(&mut server, &id, &token, message);
        assert!(error.unwrap().contains("Malformed JOIN payload"));
    });
}
