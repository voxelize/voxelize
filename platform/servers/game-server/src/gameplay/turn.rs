//! Short-lived TURN credentials for voice chat, in the form coturn checks
//! with `use-auth-secret` (the "TURN REST API"): the username is
//! `<expiry unix time>:<player id>` and the password is
//! `base64(HMAC-SHA1(secret, username))`. The secret is shared by the game
//! servers and the TURN server only; players get credentials that expire
//! and name them, so a leaked one is useless soon and traceable.

use base64::Engine;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha1::Sha1;

/// The TURN servers voice uses (`GAME_TURN_URLS`, `GAME_TURN_SECRET`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turn {
    /// `turn:host:3478?transport=udp`, `turns:…`
    pub urls: Vec<String>,
    pub secret: String,
    /// How long credentials last, in seconds (`GAME_TURN_TTL`).
    pub ttl: u64,
}

impl Turn {
    /// The ICE server entry for `player` at unix time `now`.
    pub fn ice_server(&self, player: &str, now: u64) -> Value {
        let username = format!("{}:{player}", now + self.ttl);
        let mut mac = Hmac::<Sha1>::new_from_slice(self.secret.as_bytes())
            .expect("HMAC takes any key length");
        mac.update(username.as_bytes());
        let credential =
            base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        json!({ "urls": self.urls, "username": username, "credential": credential })
    }
}

/// The ICE servers a player gets: the configured ones and, with TURN, a
/// relay with credentials of their own.
pub fn ice_servers(fixed: &Value, turn: Option<&Turn>, player: &str, now: u64) -> Value {
    let mut list = fixed.as_array().cloned().unwrap_or_default();
    if let Some(turn) = turn {
        list.push(turn.ice_server(player, now));
    }
    Value::Array(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_are_what_coturn_expects() {
        let turn = Turn {
            urls: vec!["turn:turn.example:3478?transport=udp".into()],
            secret: "turn-secret-turn-secret-0123456789ab".into(),
            ttl: 86_400,
        };
        let entry = turn.ice_server("pl_ana", 1_700_000_000);
        assert_eq!(entry["username"], "1700086400:pl_ana");
        // base64(HMAC-SHA1(secret, username)), computed independently.
        assert_eq!(entry["credential"], "N9Hl5FCkzmGsoTTZgtZHtMqhLsc=");
        assert_eq!(entry["urls"][0], "turn:turn.example:3478?transport=udp");

        let stun = json!([{ "urls": "stun:stun.example:3478" }]);
        let all = ice_servers(&stun, Some(&turn), "pl_ana", 1_700_000_000);
        assert_eq!(all.as_array().unwrap().len(), 2);
        assert_eq!(ice_servers(&stun, None, "pl_ana", 0), stun);
        assert_ne!(
            turn.ice_server("pl_bob", 1_700_000_000)["credential"],
            entry["credential"],
            "each player their own"
        );
    }
}
