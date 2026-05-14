use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{ClientFilter, Vec2};

pub const VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT: &str = "vox-builtin:sound-effect";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundEffectEvent {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pitch: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radius: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_client_id: Option<String>,
}

impl SoundEffectEvent {
    pub fn new(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            position: None,
            volume: None,
            pitch: None,
            radius: None,
            source_client_id: None,
        }
    }

    pub fn position(mut self, position: [f32; 3]) -> Self {
        self.position = Some(position);
        self
    }

    pub fn volume(mut self, volume: f32) -> Self {
        self.volume = Some(volume);
        self
    }

    pub fn pitch(mut self, pitch: f32) -> Self {
        self.pitch = Some(pitch);
        self
    }

    pub fn radius(mut self, radius: f32) -> Self {
        self.radius = Some(radius);
        self
    }

    pub fn source_client_id(mut self, source_client_id: &str) -> Self {
        self.source_client_id = Some(source_client_id.to_owned());
        self
    }
}

#[derive(Default, Clone, Debug)]
pub struct Event {
    pub name: String,
    pub payload: Option<String>,
    pub filter: Option<ClientFilter>,
    pub location: Option<Vec2<i32>>,
}

impl Event {
    pub fn new(name: &str) -> EventBuilder {
        EventBuilder::new(name)
    }

    pub fn sound_effect(payload: SoundEffectEvent) -> EventBuilder {
        EventBuilder::new(VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT).payload(payload)
    }
}

#[derive(Default)]
pub struct EventBuilder {
    name: String,
    payload: Option<String>,
    filter: Option<ClientFilter>,
    location: Option<Vec2<i32>>,
}

impl EventBuilder {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            payload: Some(json!("{}").to_string()),
            ..Default::default()
        }
    }

    pub fn payload<T: Serialize>(mut self, payload: T) -> Self {
        self.payload = Some(json!(payload).to_string());
        self
    }

    pub fn filter(mut self, filter: ClientFilter) -> Self {
        self.filter = Some(filter);
        self
    }

    pub fn location(mut self, location: Vec2<i32>) -> Self {
        self.location = Some(location);
        self
    }

    pub fn build(self) -> Event {
        Event {
            name: self.name,
            payload: self.payload,
            filter: self.filter,
            location: self.location,
        }
    }
}

#[derive(Default)]
pub struct Events {
    pub queue: Vec<Event>,
}

impl Events {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn dispatch(&mut self, event: Event) {
        self.queue.push(event);
    }
}
