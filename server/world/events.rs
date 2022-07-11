use serde::Serialize;
use serde_json::{json, Value};

use crate::{ClientFilter, Vec2};

#[derive(Default, Clone)]
pub struct Event {
    pub name: String,
    pub payload: Option<Value>,
    pub filter: Option<ClientFilter>,
    pub location: Option<Vec2<i32>>,
}

impl Event {
    pub fn new(name: &str) -> EventBuilder {
        EventBuilder::new(name)
    }
}

#[derive(Default)]
pub struct EventBuilder {
    name: String,
    payload: Option<Value>,
    filter: Option<ClientFilter>,
    location: Option<Vec2<i32>>,
}

impl EventBuilder {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            payload: Some(json!("{}")),
            ..Default::default()
        }
    }

    pub fn payload<T: Serialize>(mut self, payload: T) -> Self {
        self.payload = Some(json!(payload));
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
