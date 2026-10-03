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
        ]))
        .unwrap();
        assert_eq!(config.ticket_secrets.len(), 2);
        assert_eq!(config.seed, 77);
        assert!(!config.insecure_dev);
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
}
