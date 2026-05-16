use specs::ReadStorage;

use crate::{ClientPreferencesComp, Clients};

pub fn client_wants_server_meshes(
    clients: &Clients,
    client_id: &str,
    preferences: &ReadStorage<ClientPreferencesComp>,
) -> bool {
    clients
        .get(client_id)
        .and_then(|client| preferences.get(client.entity))
        .map(|comp| comp.0.wants_server_meshes())
        .unwrap_or(true)
}
