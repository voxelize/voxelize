//! Admits WebSocket sessions only with a backend-issued game ticket.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use platform_ticket::{Claims, Verifier};
use serde_json::json;
use voxelize::{SessionAuth, SessionAuthenticator, SessionIdentity};

/// Query parameter carrying the ticket on `/ws/?ticket=...`.
pub const TICKET_PARAM: &str = "ticket";

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Session identity for verified claims: the engine client id is the
/// player's stable public id, so reconnects resume the same player.
pub fn identity_for(claims: &Claims) -> SessionIdentity {
    SessionIdentity {
        id: Some(claims.sub.clone()),
        username: Some(claims.name.clone()),
        claims: json!({
            "sub": claims.sub,
            "realm": claims.realm,
            "roles": claims.roles,
            "world": claims.world,
        }),
    }
}

pub fn ticket_authenticator(verifier: Arc<Verifier>) -> SessionAuthenticator {
    Arc::new(move |query| {
        let Some(ticket) = query.get(TICKET_PARAM) else {
            return SessionAuth::Reject("a game ticket is required".to_owned());
        };
        match verifier.redeem(ticket, now()) {
            Ok(claims) => SessionAuth::Accept(identity_for(&claims)),
            // The reason code is safe to return: it reveals nothing about
            // the secret, and it tells an honest client whether to re-login.
            Err(error) => SessionAuth::Reject(format!("ticket rejected: {}", error.code())),
        }
    })
}
