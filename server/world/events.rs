#[derive(Default)]
pub struct Events {
    queue: Vec<(String, String)>,
}

impl Events {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn dispatch(&mut self, name: &str, payload: serde_json::Value) {
        self.queue.push((name.to_owned(), payload.to_string()))
    }
}
