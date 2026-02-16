use log::warn;
use serde::Serialize;

use crate::{ClientFilter, Vec2};

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

    pub fn new_owned(name: String) -> EventBuilder {
        EventBuilder::new_owned(name)
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
            payload: None,
            filter: None,
            location: None,
        }
    }

    pub fn new_owned(name: String) -> Self {
        Self {
            name,
            payload: None,
            filter: None,
            location: None,
        }
    }

    pub fn payload<T: Serialize>(mut self, payload: T) -> Self {
        match serde_json::to_string(&payload) {
            Ok(payload) => self.payload = Some(payload),
            Err(error) => {
                warn!("Failed to serialize event payload: {}", error);
                self.payload = None;
            }
        }
        self
    }

    pub fn payload_raw(mut self, payload: String) -> Self {
        self.payload = Some(payload);
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

#[cfg(test)]
mod tests {
    use serde::ser::Error as SerdeError;
    use serde::Serialize;

    use super::Event;

    struct FailingPayload;

    impl Serialize for FailingPayload {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            Err(S::Error::custom("serialize failure"))
        }
    }

    #[test]
    fn event_builder_without_payload_keeps_payload_empty() {
        let event = Event::new("vox-builtin:test").build();
        assert!(event.payload.is_none());
    }

    #[test]
    fn event_builder_serializes_payload_when_provided() {
        let event = Event::new("vox-builtin:test").payload(42).build();
        assert_eq!(event.payload.as_deref(), Some("42"));
    }

    #[test]
    fn event_builder_skips_payload_when_serialization_fails() {
        let event = Event::new("vox-builtin:test")
            .payload(FailingPayload)
            .build();
        assert!(event.payload.is_none());
    }

    #[test]
    fn event_builder_payload_raw_keeps_existing_json() {
        let raw_payload = String::from("{\"a\":1}");
        let event = Event::new("vox-builtin:test")
            .payload_raw(raw_payload.clone())
            .build();
        assert_eq!(event.payload, Some(raw_payload));
    }

    #[test]
    fn event_builder_new_owned_keeps_name_without_copying() {
        let event = Event::new_owned(String::from("vox-builtin:test")).build();
        assert_eq!(event.name, "vox-builtin:test");
    }
}
