//! Game server configuration, read from the environment.
//!
//! Every value has a documented default except secrets: a server reachable
//! by players must be given ticket and transport secrets, and refuses to
//! start without them unless `GAME_INSECURE_DEV=1` says this is a local
//! development process.

use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
pub struct GameConfig {
    pub port: u16,
    pub world: String,
    pub seed: u32,
    pub sea_level: i32,
    pub preload_radius: usize,
    pub content_dir: PathBuf,
    pub save_dir: PathBuf,
    /// Ticket signing secrets, newest first. Empty only in insecure dev.
    pub ticket_secrets: Vec<Vec<u8>>,
    /// Secret transport (bridge) connections must present.
    pub transport_secret: Option<String>,
    pub insecure_dev: bool,
    /// The business backend's internal API (land, market); `None` only
    /// when explicitly off.
    pub backend: Option<Backend>,
    /// Seconds a siege banner must hold, with its guild near and no
    /// defender, to capture the land.
    pub siege_seconds: f32,
    /// ICE servers voice chat peers use (`GAME_VOICE_ICE_SERVERS`, the JSON
    /// array an `RTCPeerConnection` takes); empty: direct connections only.
    pub voice_ice_servers: serde_json::Value,
    /// Bearer token `/platform/metrics` asks for (`GAME_METRICS_TOKEN`);
    /// none: open (keep it off the public listener).
    pub metrics_token: Option<String>,
    /// Movement checks (`GAME_ANTICHEAT`, on unless `off`: scripted test
    /// bots move by setting positions and would be caught).
    pub anticheat: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Backend {
    /// Base of the internal API, e.g. `http://nginx:8081/api/internal/v1`.
    pub url: String,
    pub token: String,
    /// How often land claims are refreshed.
    pub land_interval_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError(pub String);

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ConfigError {}

fn parse<T: std::str::FromStr>(
    env: &HashMap<String, String>,
    key: &str,
    default: T,
) -> Result<T, ConfigError> {
    match env.get(key).map(|v| v.trim()).filter(|v| !v.is_empty()) {
        None => Ok(default),
        Some(raw) => raw
            .parse()
            .map_err(|_| ConfigError(format!("{key}={raw:?} is not a valid value"))),
    }
}

impl GameConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_map(&std::env::vars().collect())
    }

    pub fn from_map(env: &HashMap<String, String>) -> Result<Self, ConfigError> {
        let insecure_dev = parse(env, "GAME_INSECURE_DEV", 0u8)? == 1;
        let world = env
            .get("GAME_WORLD_NAME")
            .cloned()
            .unwrap_or_else(|| "main".to_owned());
        if !platform_content::is_valid_key(&world) {
            return Err(ConfigError(format!(
                "GAME_WORLD_NAME={world:?} must be snake_case"
            )));
        }

        let ticket_secrets: Vec<Vec<u8>> = env
            .get("GAME_TICKET_SECRETS")
            .map(|raw| {
                raw.split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.as_bytes().to_vec())
                    .collect()
            })
            .unwrap_or_default();
        if ticket_secrets.iter().any(|s| s.len() < 32) {
            return Err(ConfigError(
                "every GAME_TICKET_SECRETS entry must be at least 32 bytes".into(),
            ));
        }
        let transport_secret = env
            .get("GAME_TRANSPORT_SECRET")
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());
        if !insecure_dev {
            if ticket_secrets.is_empty() {
                return Err(ConfigError(
                    "GAME_TICKET_SECRETS is required (set GAME_INSECURE_DEV=1 for local development only)".into(),
                ));
            }
            match &transport_secret {
                Some(secret) if secret.len() >= 32 => {}
                _ => {
                    return Err(ConfigError(
                        "GAME_TRANSPORT_SECRET of at least 32 bytes is required".into(),
                    ))
                }
            }
        }

        // The backend (land claims, market): a reachable server must either
        // use it or say explicitly that this world has none of that
        // (GAME_BACKEND_URL=off).
        let backend = match env.get("GAME_BACKEND_URL").map(|s| s.trim()) {
            Some("off") => None,
            None | Some("") if insecure_dev => None,
            None | Some("") => {
                return Err(ConfigError(
                    "GAME_BACKEND_URL is required (the backend's /api/internal/v1, or `off` for a world without land and market)".into(),
                ))
            }
            Some(url) => {
                if !url.starts_with("http://") && !url.starts_with("https://") {
                    return Err(ConfigError(format!("GAME_BACKEND_URL={url:?} must be an http(s) URL")));
                }
                let token = env
                    .get("GAME_SERVICE_TOKEN")
                    .map(|s| s.trim().to_owned())
                    .unwrap_or_default();
                if token.len() < 32 {
                    return Err(ConfigError(
                        "GAME_SERVICE_TOKEN of at least 32 bytes is required with a backend".into(),
                    ));
                }
                let land_interval_ms = parse(env, "GAME_LAND_FEED_INTERVAL_MS", 5000u64)?;
                if !(200..=600_000).contains(&land_interval_ms) {
                    return Err(ConfigError(
                        "GAME_LAND_FEED_INTERVAL_MS must be within 200..=600000".into(),
                    ));
                }
                Some(Backend {
                    url: url.trim_end_matches('/').to_owned(),
                    token,
                    land_interval_ms,
                })
            }
        };

        let sea_level = parse(env, "GAME_SEA_LEVEL", 64i32)?;
        if !(16..=200).contains(&sea_level) {
            return Err(ConfigError("GAME_SEA_LEVEL must be within 16..=200".into()));
        }

        Ok(Self {
            port: parse(env, "GAME_PORT", 4000u16)?,
            world,
            seed: parse(env, "GAME_WORLD_SEED", 20_260_101u32)?,
            sea_level,
            preload_radius: parse(env, "GAME_PRELOAD_RADIUS", 3usize)?,
            content_dir: env
                .get("GAME_CONTENT_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(platform_content::default_pack_dir),
            save_dir: env
                .get("GAME_SAVE_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("data/worlds")),
            ticket_secrets,
            transport_secret,
            insecure_dev,
            backend,
            siege_seconds: {
                let s = parse(env, "GAME_SIEGE_SECONDS", 600u32)?;
                if !(5..=86_400).contains(&s) {
                    return Err(ConfigError(
                        "GAME_SIEGE_SECONDS must be within 5..=86400".into(),
                    ));
                }
                s as f32
            },
            anticheat: env.get("GAME_ANTICHEAT").is_none_or(|v| v != "off"),
            metrics_token: env
                .get("GAME_METRICS_TOKEN")
                .filter(|t| !t.is_empty())
                .cloned(),
            voice_ice_servers: match env.get("GAME_VOICE_ICE_SERVERS") {
                None => serde_json::json!([]),
                Some(raw) => match serde_json::from_str::<serde_json::Value>(raw) {
                    Ok(v @ serde_json::Value::Array(_)) => v,
                    _ => {
                        return Err(ConfigError(
                            "GAME_VOICE_ICE_SERVERS must be a JSON array of ICE servers".into(),
                        ))
                    }
                },
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn production_requires_secrets() {
        let error = GameConfig::from_map(&env(&[])).unwrap_err();
        assert!(error.0.contains("GAME_TICKET_SECRETS"));
        let error = GameConfig::from_map(&env(&[("GAME_TICKET_SECRETS", SECRET)])).unwrap_err();
        assert!(error.0.contains("GAME_TRANSPORT_SECRET"));
        let error = GameConfig::from_map(&env(&[("GAME_TICKET_SECRETS", "short")])).unwrap_err();
        assert!(error.0.contains("32 bytes"));
    }

    #[test]
    fn secure_config_parses_rotation_list() {
        let config = GameConfig::from_map(&env(&[
            ("GAME_TICKET_SECRETS", &format!("{SECRET}, {SECRET}x")),
            ("GAME_TRANSPORT_SECRET", SECRET),
            ("GAME_WORLD_SEED", "77"),
            ("GAME_BACKEND_URL", "http://nginx:8081/api/internal/v1/"),
            ("GAME_SERVICE_TOKEN", SECRET),
        ]))
        .unwrap();
        assert_eq!(config.ticket_secrets.len(), 2);
        assert_eq!(config.seed, 77);
        assert!(!config.insecure_dev);
        let backend = config.backend.unwrap();
        assert_eq!(backend.land_interval_ms, 5000);
        assert_eq!(backend.url, "http://nginx:8081/api/internal/v1");
    }

    #[test]
    fn production_uses_the_backend_or_says_it_has_none() {
        let base = [
            ("GAME_TICKET_SECRETS", SECRET),
            ("GAME_TRANSPORT_SECRET", SECRET),
        ];
        let with = |extra: &[(&str, &str)]| {
            let mut pairs = base.to_vec();
            pairs.extend_from_slice(extra);
            GameConfig::from_map(&env(&pairs))
        };
        assert!(with(&[]).unwrap_err().0.contains("GAME_BACKEND_URL"));
        assert!(with(&[("GAME_BACKEND_URL", "off")])
            .unwrap()
            .backend
            .is_none());
        let error = with(&[("GAME_BACKEND_URL", "http://api/internal")]).unwrap_err();
        assert!(error.0.contains("GAME_SERVICE_TOKEN"));
        let error = with(&[
            ("GAME_BACKEND_URL", "ftp://x"),
            ("GAME_SERVICE_TOKEN", SECRET),
        ])
        .unwrap_err();
        assert!(error.0.contains("http"));
    }

    #[test]
    fn insecure_dev_needs_no_secrets_and_bad_values_fail_loudly() {
        assert!(GameConfig::from_map(&env(&[("GAME_INSECURE_DEV", "1")])).is_ok());
        let error =
            GameConfig::from_map(&env(&[("GAME_INSECURE_DEV", "1"), ("GAME_PORT", "http")]))
                .unwrap_err();
        assert!(error.0.contains("GAME_PORT"));
        let error = GameConfig::from_map(&env(&[
            ("GAME_INSECURE_DEV", "1"),
            ("GAME_WORLD_NAME", "Main World"),
        ]))
        .unwrap_err();
        assert!(error.0.contains("snake_case"));
    }

    #[test]
    fn voice_ice_servers_are_a_json_array() {
        let dev = |extra: &[(&str, &str)]| {
            let mut pairs = vec![("GAME_INSECURE_DEV", "1")];
            pairs.extend_from_slice(extra);
            GameConfig::from_map(&env(&pairs))
        };
        assert_eq!(dev(&[]).unwrap().voice_ice_servers, serde_json::json!([]));
        let ice = r#"[{"urls":"turn:turn.example:3478","username":"u","credential":"c"}]"#;
        assert_eq!(
            dev(&[("GAME_VOICE_ICE_SERVERS", ice)])
                .unwrap()
                .voice_ice_servers[0]["urls"],
            "turn:turn.example:3478"
        );
        let error = dev(&[("GAME_VOICE_ICE_SERVERS", "{}")]).unwrap_err();
        assert!(error.0.contains("GAME_VOICE_ICE_SERVERS"));
    }
}
