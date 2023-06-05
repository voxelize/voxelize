use hashbrown::HashSet;

use crate::Client;

/// A filter for clients, used for specific broadcasting.
#[derive(Clone)]
pub enum ClientFilter {
    All,
    Direct(String),
    Include(HashSet<String>),
    Exclude(HashSet<String>),
}

impl ClientFilter {
    /// Creates a new filter that includes all clients.
    pub fn all() -> Self {
        ClientFilter::All
    }

    /// Creates a new filter that includes only the client with the given ID.
    pub fn direct(id: &str) -> Self {
        ClientFilter::Direct(id.to_string())
    }

    /// Creates a new filter that includes only the clients with the given IDs.
    pub fn include(ids: &[&str]) -> Self {
        ClientFilter::Include(ids.iter().map(|id| id.to_string()).collect())
    }

    /// Creates a new filter that excludes the client with the given ID.
    pub fn exclude(ids: &[&str]) -> Self {
        ClientFilter::Exclude(ids.iter().map(|id| id.to_string()).collect())
    }

    /// Returns true if the client should be included.
    pub fn filter(&self, client_id: &str) -> bool {
        match self {
            ClientFilter::All => true,
            ClientFilter::Direct(id) => id == client_id,
            ClientFilter::Include(ids) => ids.contains(&client_id.to_string()),
            ClientFilter::Exclude(ids) => !ids.contains(&client_id.to_string()),
        }
    }

    /// Returns true if the client should be included.
    pub fn filter_client(&self, client: &Client) -> bool {
        self.filter(&client.id)
    }
}
