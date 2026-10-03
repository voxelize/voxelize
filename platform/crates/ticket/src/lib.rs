//! Game tickets: the only credential a game server ever sees.
//!
//! The backend (Laravel) authenticates the player with their password or
//! session, then issues a short-lived, single-use ticket for one world. The
//! game server verifies it with a shared secret and never learns the
//! player's password or web session.
//!
//! Wire format (`docs/SECURITY.md` has the full contract):
//!
//! ```text
//! v1.<base64url(payload json)>.<base64url(HMAC-SHA256(secret, "v1." + payload part))>
//! ```
//!
//! Base64url is unpadded. Several secrets may be configured at once so the
//! backend can rotate keys without disconnecting anyone.

use std::collections::HashMap;
use std::sync::Mutex;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

pub const VERSION_PREFIX: &str = "v1.";
pub const DEFAULT_ISSUER: &str = "platform-api";
pub const DEFAULT_AUDIENCE: &str = "game";

type HmacSha256 = Hmac<Sha256>;

/// Economy realm a session plays in. Items and currency never cross realms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Realm {
    Survival,
    Creative,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Claims {
    pub iss: String,
    pub aud: String,
    /// Stable public id of the player (never the database primary key).
    pub sub: String,
    /// Display name, already validated by the backend.
    pub name: String,
    /// World the ticket admits to.
    pub world: String,
    pub realm: Realm,
    #[serde(default)]
    pub roles: Vec<String>,
    /// Issued-at, unix seconds.
    pub iat: i64,
    /// Expiry, unix seconds.
    pub exp: i64,
    /// Unique ticket id, used once.
    pub jti: String,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TicketError {
    #[error("ticket is malformed")]
    Malformed,
    #[error("ticket version is not supported")]
    UnsupportedVersion,
    #[error("ticket signature is invalid")]
    BadSignature,
    #[error("ticket has expired")]
    Expired,
    #[error("ticket is not valid yet")]
    NotYetValid,
    #[error("ticket lifetime exceeds the allowed maximum")]
    LifetimeTooLong,
    #[error("ticket was issued for another audience")]
    WrongAudience,
    #[error("ticket was issued by an unknown issuer")]
    WrongIssuer,
    #[error("ticket was issued for another world")]
    WrongWorld,
    #[error("ticket has already been used")]
    Replayed,
}

impl TicketError {
    /// Stable machine code, shared with the backend's test vectors.
    pub fn code(&self) -> &'static str {
        match self {
            TicketError::Malformed => "malformed",
            TicketError::UnsupportedVersion => "unsupported_version",
            TicketError::BadSignature => "bad_signature",
            TicketError::Expired => "expired",
            TicketError::NotYetValid => "not_yet_valid",
            TicketError::LifetimeTooLong => "lifetime_too_long",
            TicketError::WrongAudience => "wrong_audience",
            TicketError::WrongIssuer => "wrong_issuer",
            TicketError::WrongWorld => "wrong_world",
            TicketError::Replayed => "replayed",
        }
    }
}

/// Sign claims into a ticket. The backend is the production issuer; this
/// exists for tests, load-test bots and local tooling.
pub fn sign(claims: &Claims, secret: &[u8]) -> String {
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).expect("claims serialize"));
    let signed = format!("{VERSION_PREFIX}{payload}");
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(signed.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{signed}.{signature}")
}

#[derive(Debug, Clone)]
pub struct VerifierConfig {
    pub issuer: String,
    pub audience: String,
    /// The world this server hosts; tickets for other worlds are refused.
    pub world: String,
    /// Longest `exp - iat` accepted, in seconds.
    pub max_lifetime_secs: i64,
    /// Clock skew tolerated between backend and game server, in seconds.
    pub leeway_secs: i64,
}

impl VerifierConfig {
    pub fn for_world(world: impl Into<String>) -> Self {
        Self {
            issuer: DEFAULT_ISSUER.to_owned(),
            audience: DEFAULT_AUDIENCE.to_owned(),
            world: world.into(),
            max_lifetime_secs: 300,
            leeway_secs: 5,
        }
    }
}

/// Verifies tickets and remembers which were used until they expire.
pub struct Verifier {
    secrets: Vec<Vec<u8>>,
    config: VerifierConfig,
    used: Mutex<HashMap<String, i64>>,
}

impl Verifier {
    /// `secrets` is every currently valid signing key, newest first.
    pub fn new(secrets: Vec<Vec<u8>>, config: VerifierConfig) -> Self {
        assert!(!secrets.is_empty(), "a verifier needs at least one secret");
        assert!(
            secrets.iter().all(|s| s.len() >= 32),
            "ticket secrets must be at least 32 bytes"
        );
        Self {
            secrets,
            config,
            used: Mutex::new(HashMap::new()),
        }
    }

    /// Check signature and claims without consuming the ticket.
    pub fn inspect(&self, token: &str, now: i64) -> Result<Claims, TicketError> {
        let rest = token
            .strip_prefix(VERSION_PREFIX)
            .ok_or(if token.contains('.') {
                TicketError::UnsupportedVersion
            } else {
                TicketError::Malformed
            })?;
        let (payload, signature) = rest.split_once('.').ok_or(TicketError::Malformed)?;
        if payload.is_empty() || signature.is_empty() || signature.contains('.') {
            return Err(TicketError::Malformed);
        }
        let signature = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|_| TicketError::Malformed)?;
        let signed = &token[..VERSION_PREFIX.len() + payload.len()];
        let authentic = self.secrets.iter().any(|secret| {
            let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts any key length");
            mac.update(signed.as_bytes());
            // verify_slice compares in constant time.
            mac.verify_slice(&signature).is_ok()
        });
        if !authentic {
            return Err(TicketError::BadSignature);
        }

        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| TicketError::Malformed)?;
        let claims: Claims = serde_json::from_slice(&bytes).map_err(|_| TicketError::Malformed)?;

        if claims.iss != self.config.issuer {
            return Err(TicketError::WrongIssuer);
        }
        if claims.aud != self.config.audience {
            return Err(TicketError::WrongAudience);
        }
        if claims.world != self.config.world {
            return Err(TicketError::WrongWorld);
        }
        if claims.sub.is_empty() || claims.jti.is_empty() || claims.name.is_empty() {
            return Err(TicketError::Malformed);
        }
        if claims.exp - claims.iat > self.config.max_lifetime_secs || claims.exp <= claims.iat {
            return Err(TicketError::LifetimeTooLong);
        }
        if claims.iat > now + self.config.leeway_secs {
            return Err(TicketError::NotYetValid);
        }
        if claims.exp + self.config.leeway_secs <= now {
            return Err(TicketError::Expired);
        }
        Ok(claims)
    }

    /// Verify and consume: a ticket admits exactly one session.
    pub fn redeem(&self, token: &str, now: i64) -> Result<Claims, TicketError> {
        let claims = self.inspect(token, now)?;
        let mut used = self
            .used
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let leeway = self.config.leeway_secs;
        used.retain(|_, exp| *exp + leeway > now);
        if used.contains_key(&claims.jti) {
            return Err(TicketError::Replayed);
        }
        used.insert(claims.jti.clone(), claims.exp);
        Ok(claims)
    }

    /// Number of remembered ticket ids (for metrics).
    pub fn remembered(&self) -> usize {
        self.used.lock().map(|u| u.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &[u8] = b"0123456789abcdef0123456789abcdef";

    fn claims(now: i64) -> Claims {
        Claims {
            iss: DEFAULT_ISSUER.into(),
            aud: DEFAULT_AUDIENCE.into(),
            sub: "pl_01".into(),
            name: "Builder".into(),
            world: "main".into(),
            realm: Realm::Survival,
            roles: vec!["player".into()],
            iat: now,
            exp: now + 120,
            jti: "t-1".into(),
        }
    }

    fn verifier() -> Verifier {
        Verifier::new(vec![SECRET.to_vec()], VerifierConfig::for_world("main"))
    }

    #[test]
    fn round_trip_and_single_use() {
        let token = sign(&claims(1000), SECRET);
        let v = verifier();
        assert_eq!(v.redeem(&token, 1010).unwrap().sub, "pl_01");
        assert_eq!(v.redeem(&token, 1011), Err(TicketError::Replayed));
    }

    #[test]
    fn tampering_is_detected() {
        let token = sign(&claims(1000), SECRET);
        let mut forged = claims(1000);
        forged.realm = Realm::Creative;
        let forged_payload = sign(&forged, SECRET);
        let signature = token.rsplit_once('.').unwrap().1;
        let spliced = format!(
            "{}.{}",
            forged_payload.rsplit_once('.').unwrap().0,
            signature
        );
        assert_eq!(
            verifier().inspect(&spliced, 1000),
            Err(TicketError::BadSignature)
        );
        assert_eq!(
            verifier().inspect(
                &sign(&claims(1000), b"another-secret-another-secret-xx"),
                1000
            ),
            Err(TicketError::BadSignature)
        );
    }

    #[test]
    fn rotation_accepts_any_configured_secret() {
        let old = b"old-secret-old-secret-old-secret".to_vec();
        let v = Verifier::new(
            vec![SECRET.to_vec(), old.clone()],
            VerifierConfig::for_world("main"),
        );
        assert!(v.inspect(&sign(&claims(1000), &old), 1000).is_ok());
    }

    #[test]
    fn time_bounds() {
        let token = sign(&claims(1000), SECRET);
        assert_eq!(verifier().inspect(&token, 1125), Err(TicketError::Expired));
        assert!(verifier().inspect(&token, 1124).is_ok());
        assert_eq!(
            verifier().inspect(&token, 990),
            Err(TicketError::NotYetValid)
        );
        let mut long = claims(1000);
        long.exp = 1000 + 3600;
        assert_eq!(
            verifier().inspect(&sign(&long, SECRET), 1000),
            Err(TicketError::LifetimeTooLong)
        );
    }

    #[test]
    fn scope_checks() {
        let mut other_world = claims(1000);
        other_world.world = "arena".into();
        assert_eq!(
            verifier().inspect(&sign(&other_world, SECRET), 1000),
            Err(TicketError::WrongWorld)
        );
        let mut other_aud = claims(1000);
        other_aud.aud = "web".into();
        assert_eq!(
            verifier().inspect(&sign(&other_aud, SECRET), 1000),
            Err(TicketError::WrongAudience)
        );
    }

    #[test]
    fn garbage_is_malformed_not_a_panic() {
        let v = verifier();
        for token in [
            "",
            "v1.",
            "v1..",
            "v1.abc",
            "v1.abc.def.ghi",
            "v1.!!.@@",
            "nonsense",
        ] {
            assert!(v.inspect(token, 0).is_err(), "{token}");
        }
        assert_eq!(
            v.inspect("v2.abc.def", 0),
            Err(TicketError::UnsupportedVersion)
        );
    }

    /// Vectors shared with the backend's PHP issuer, generated independently,
    /// so both sides agree on the exact bytes.
    #[test]
    fn shared_vectors() {
        #[derive(Deserialize)]
        struct Case {
            name: String,
            token: String,
            world: String,
            now: i64,
            expect: String,
        }
        #[derive(Deserialize)]
        struct Vectors {
            secret: String,
            cases: Vec<Case>,
        }
        let text = include_str!("../../../tests/fixtures/game-ticket-vectors.json");
        let vectors: Vectors = serde_json::from_str(text).unwrap();
        for case in vectors.cases {
            let v = Verifier::new(
                vec![vectors.secret.as_bytes().to_vec()],
                VerifierConfig::for_world(case.world.clone()),
            );
            let got = match v.inspect(&case.token, case.now) {
                Ok(_) => "ok".to_owned(),
                Err(error) => error.code().to_owned(),
            };
            assert_eq!(got, case.expect, "vector {}", case.name);
        }
    }
}
