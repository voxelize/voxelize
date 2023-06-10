#[derive(Default, Debug)]
pub struct Client {
    pub id: String,
    pub username: String,
}

impl Client {
    pub fn new(id: &str, username: &str) -> Self {
        Self {
            id: id.to_string(),
            username: username.to_string(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn username(&self) -> &str {
        &self.username
    }
}
