use serde::{Deserialize, Serialize};
use specs::Component;

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPreferences {
    pub client_only_meshing: bool,
}

impl ClientPreferences {
    pub fn apply_patch(mut self, patch: ClientPreferencesPatch) -> Self {
        self.apply_patch_mut(patch);
        self
    }

    pub fn apply_patch_mut(&mut self, patch: ClientPreferencesPatch) {
        if let Some(client_only_meshing) = patch.client_only_meshing {
            self.client_only_meshing = client_only_meshing;
        }
    }

    pub fn wants_server_meshes(&self) -> bool {
        !self.client_only_meshing
    }
}

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPreferencesPatch {
    pub client_only_meshing: Option<bool>,
}

impl ClientPreferencesPatch {
    pub fn is_empty(&self) -> bool {
        self.client_only_meshing.is_none()
    }

    pub fn merge(mut self, other: Self) -> Self {
        if other.client_only_meshing.is_some() {
            self.client_only_meshing = other.client_only_meshing;
        }
        self
    }
}

pub fn parse_preferences_patch(json: &str) -> ClientPreferencesPatch {
    #[derive(Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Envelope {
        #[serde(default, flatten)]
        flat: ClientPreferencesPatch,
        preferences: Option<ClientPreferencesPatch>,
    }

    let envelope: Envelope = serde_json::from_str(json).unwrap_or_default();
    envelope.flat.merge(envelope.preferences.unwrap_or_default())
}

#[derive(Default, Clone, Copy)]
pub struct ClientPreferencesComp(pub ClientPreferences);

impl Component for ClientPreferencesComp {
    type Storage = specs::DenseVecStorage<Self>;
}
