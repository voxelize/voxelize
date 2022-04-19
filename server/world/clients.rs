use hashbrown::HashMap;
use message_io::network::Endpoint;

use specs::Entity;

/// A client of the server.
#[derive(Clone)]
pub struct Client {
    /// The client's ID on the voxelize server.
    pub id: String,

    /// The entity that represents this client in the ECS world.
    pub entity: Entity,
}

#[derive(Default)]
pub struct Clients {
    pub list: HashMap<Endpoint, Client>,

    id_to_endpoints: HashMap<String, Endpoint>,
}

impl Clients {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, endpoint: &Endpoint) -> Option<&Client> {
        self.list.get(endpoint)
    }

    pub fn get_by_id(&self, id: &str) -> Option<&Client> {
        if let Some(endpoint) = self.id_to_endpoint(id) {
            return self.list.get(endpoint);
        }

        None
    }

    pub fn add(&mut self, endpoint: &Endpoint, id: &str, ent: &Entity) -> &Client {
        self.list.remove(&endpoint);

        self.list.insert(
            endpoint.to_owned(),
            Client {
                id: id.to_owned(),
                entity: ent.to_owned(),
            },
        );

        self.id_to_endpoints
            .insert(id.to_owned(), endpoint.to_owned());

        self.list.get(endpoint).unwrap()
    }

    pub fn remove(&mut self, endpoint: &Endpoint) -> Option<Client> {
        let client = self.list.remove(endpoint);

        if client.is_some() {
            let id = client.clone().unwrap().id;
            self.id_to_endpoints.remove(&id);
        }

        client
    }

    pub fn has(&self, endpoint: &Endpoint) -> bool {
        self.list.contains_key(endpoint)
    }

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    pub fn id_to_endpoint(&self, id: &str) -> Option<&Endpoint> {
        self.id_to_endpoints.get(id)
    }

    pub fn id_list(&self) -> Vec<String> {
        let mut list = vec![];

        self.list.values().for_each(|client| {
            list.push(client.id.clone());
        });

        list
    }
}
