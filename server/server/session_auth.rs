use std::sync::Arc;

use hashbrown::HashMap;
use serde_json::Value;

/// Who a connecting socket is, as decided by the adapter's
/// [`SessionAuthenticator`] before the session is registered.
///
/// The engine itself has no opinion about credentials: it only needs to know
/// which client id to register the socket under, which display name (if any)
/// outranks the JOIN payload's, and what verified facts the game wants to read
/// about the session later (`SessionIdentities` resource on every world).
#[derive(Clone, Debug, Default)]
pub struct SessionIdentity {
    /// The client id the socket is registered under. `None` lets the server
    /// mint a fresh one, which is what an unauthenticated session gets.
    pub id: Option<String>,

    /// Trusted display name. When set, it overrides the username the client
    /// sends in its JOIN payload.
    pub username: Option<String>,

    /// Adapter-defined verified claims (role, cosmetics, ...). `Null` for a
    /// session that presented nothing verifiable.
    pub claims: Value,
}

impl SessionIdentity {
    /// An identity that trusts the given client id and carries no claims —
    /// the pre-authentication behavior, still the right answer for local
    /// harnesses and tests.
    pub fn for_client(id: impl Into<String>) -> Self {
        Self {
            id: Some(id.into()),
            username: None,
            claims: Value::Null,
        }
    }

    /// An identity with no id (server mints one) and no claims.
    pub fn anonymous() -> Self {
        Self::default()
    }

    /// Whether this session presented verified claims, as opposed to being
    /// admitted on the permissive fallback.
    pub fn is_verified(&self) -> bool {
        !self.claims.is_null()
    }
}

/// Outcome of authenticating one connection attempt.
pub enum SessionAuth {
    /// Admit the socket as this identity.
    Accept(SessionIdentity),
    /// Refuse the upgrade; the string is the reason returned to the client.
    Reject(String),
}

/// Adapter hook run on every `/ws/` upgrade (and every WebRTC offer) with
/// the request's query parameters. Games install one with
/// [`crate::ServerBuilder::session_authenticator`]; without it the engine
/// falls back to [`permissive_session_auth`].
pub type SessionAuthenticator =
    Arc<dyn Fn(&HashMap<String, String>) -> SessionAuth + Send + Sync>;

/// Query parameter carrying the client's requested id.
pub const CLIENT_ID_PARAM: &str = "client_id";

/// The engine's historical behavior: honour whatever `client_id` the client
/// asked for, or mint one. Only acceptable when the process is not reachable
/// by untrusted clients (local development, tests, harnesses).
pub fn permissive_session_auth(query: &HashMap<String, String>) -> SessionAuth {
    let id = query
        .get(CLIENT_ID_PARAM)
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(str::to_owned);
    SessionAuth::Accept(SessionIdentity {
        id,
        username: None,
        claims: Value::Null,
    })
}

/// Run the configured authenticator (or the permissive fallback) over a
/// request's query parameters.
pub fn authenticate_session(
    authenticator: Option<&SessionAuthenticator>,
    query: &HashMap<String, String>,
) -> SessionAuth {
    match authenticator {
        Some(authenticator) => authenticator(query),
        None => permissive_session_auth(query),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn permissive_auth_honours_client_id_and_mints_otherwise() {
        match permissive_session_auth(&query(&[("client_id", "abc")])) {
            SessionAuth::Accept(identity) => {
                assert_eq!(identity.id.as_deref(), Some("abc"));
                assert!(!identity.is_verified());
            }
            SessionAuth::Reject(_) => panic!("permissive auth never rejects"),
        }
        match permissive_session_auth(&query(&[("client_id", "  ")])) {
            SessionAuth::Accept(identity) => assert!(identity.id.is_none()),
            SessionAuth::Reject(_) => panic!("permissive auth never rejects"),
        }
    }

    #[test]
    fn configured_authenticator_is_preferred_over_fallback() {
        let authenticator: SessionAuthenticator =
            Arc::new(|_| SessionAuth::Reject("nope".to_owned()));
        match authenticate_session(Some(&authenticator), &query(&[("client_id", "abc")])) {
            SessionAuth::Reject(reason) => assert_eq!(reason, "nope"),
            SessionAuth::Accept(_) => panic!("configured authenticator must decide"),
        }
    }
}
