use hashbrown::HashMap;

use crate::Clients;

#[inline]
fn next_client_id<'a, I>(client_ids: &mut I) -> &'a str
where
    I: Iterator<Item = &'a String>,
{
    let Some(client_id) = client_ids.next() else {
        unreachable!("client count matched branch");
    };
    client_id.as_str()
}

#[inline]
pub(crate) fn retain_active_client_batches_map<T>(
    batches: &mut HashMap<String, T>,
    clients: &Clients,
) {
    if batches.len() <= clients.len() {
        return;
    }
    match clients.len() {
        0 => {
            batches.clear();
        }
        1 => {
            let mut client_ids = clients.keys();
            let single_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| client_id.as_str() == single_client_id);
        }
        2 => {
            let mut client_ids = clients.keys();
            let first_client_id = next_client_id(&mut client_ids);
            let second_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id || client_id == second_client_id
            });
        }
        3 => {
            let mut client_ids = clients.keys();
            let first_client_id = next_client_id(&mut client_ids);
            let second_client_id = next_client_id(&mut client_ids);
            let third_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id
                    || client_id == second_client_id
                    || client_id == third_client_id
            });
        }
        4 => {
            let mut client_ids = clients.keys();
            let first_client_id = next_client_id(&mut client_ids);
            let second_client_id = next_client_id(&mut client_ids);
            let third_client_id = next_client_id(&mut client_ids);
            let fourth_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id
                    || client_id == second_client_id
                    || client_id == third_client_id
                    || client_id == fourth_client_id
            });
        }
        5 => {
            let mut client_ids = clients.keys();
            let first_client_id = next_client_id(&mut client_ids);
            let second_client_id = next_client_id(&mut client_ids);
            let third_client_id = next_client_id(&mut client_ids);
            let fourth_client_id = next_client_id(&mut client_ids);
            let fifth_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id
                    || client_id == second_client_id
                    || client_id == third_client_id
                    || client_id == fourth_client_id
                    || client_id == fifth_client_id
            });
        }
        6 => {
            let mut client_ids = clients.keys();
            let first_client_id = next_client_id(&mut client_ids);
            let second_client_id = next_client_id(&mut client_ids);
            let third_client_id = next_client_id(&mut client_ids);
            let fourth_client_id = next_client_id(&mut client_ids);
            let fifth_client_id = next_client_id(&mut client_ids);
            let sixth_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id
                    || client_id == second_client_id
                    || client_id == third_client_id
                    || client_id == fourth_client_id
                    || client_id == fifth_client_id
                    || client_id == sixth_client_id
            });
        }
        7 => {
            let mut client_ids = clients.keys();
            let first_client_id = next_client_id(&mut client_ids);
            let second_client_id = next_client_id(&mut client_ids);
            let third_client_id = next_client_id(&mut client_ids);
            let fourth_client_id = next_client_id(&mut client_ids);
            let fifth_client_id = next_client_id(&mut client_ids);
            let sixth_client_id = next_client_id(&mut client_ids);
            let seventh_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id
                    || client_id == second_client_id
                    || client_id == third_client_id
                    || client_id == fourth_client_id
                    || client_id == fifth_client_id
                    || client_id == sixth_client_id
                    || client_id == seventh_client_id
            });
        }
        8 => {
            let mut client_ids = clients.keys();
            let first_client_id = next_client_id(&mut client_ids);
            let second_client_id = next_client_id(&mut client_ids);
            let third_client_id = next_client_id(&mut client_ids);
            let fourth_client_id = next_client_id(&mut client_ids);
            let fifth_client_id = next_client_id(&mut client_ids);
            let sixth_client_id = next_client_id(&mut client_ids);
            let seventh_client_id = next_client_id(&mut client_ids);
            let eighth_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id
                    || client_id == second_client_id
                    || client_id == third_client_id
                    || client_id == fourth_client_id
                    || client_id == fifth_client_id
                    || client_id == sixth_client_id
                    || client_id == seventh_client_id
                    || client_id == eighth_client_id
            });
        }
        9 => {
            let mut client_ids = clients.keys();
            let first_client_id = next_client_id(&mut client_ids);
            let second_client_id = next_client_id(&mut client_ids);
            let third_client_id = next_client_id(&mut client_ids);
            let fourth_client_id = next_client_id(&mut client_ids);
            let fifth_client_id = next_client_id(&mut client_ids);
            let sixth_client_id = next_client_id(&mut client_ids);
            let seventh_client_id = next_client_id(&mut client_ids);
            let eighth_client_id = next_client_id(&mut client_ids);
            let ninth_client_id = next_client_id(&mut client_ids);
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id
                    || client_id == second_client_id
                    || client_id == third_client_id
                    || client_id == fourth_client_id
                    || client_id == fifth_client_id
                    || client_id == sixth_client_id
                    || client_id == seventh_client_id
                    || client_id == eighth_client_id
                    || client_id == ninth_client_id
            });
        }
        _ => {
            batches.retain(|client_id, _| clients.contains_key(client_id));
        }
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use hashbrown::HashMap;
    use specs::{Builder, World, WorldExt};
    use tokio::sync::mpsc;

    use super::retain_active_client_batches_map;
    use crate::{Client, Clients};

    fn make_client(world: &mut World, id: &str) -> Client {
        let entity = world.create_entity().build();
        let (sender, _receiver) = mpsc::unbounded_channel::<Bytes>();
        Client {
            id: id.to_string(),
            username: id.to_string(),
            entity,
            sender,
        }
    }

    #[test]
    fn retain_active_client_batches_map_keeps_only_nine_active_clients() {
        let mut world = World::new();
        let mut clients = Clients::new();
        for id in ["a", "b", "c", "d", "e", "f", "g", "h", "i"] {
            clients.insert(id.to_string(), make_client(&mut world, id));
        }

        let mut batches: HashMap<String, i32> = HashMap::new();
        for id in ["a", "b", "c", "d", "e", "f", "g", "h", "i"] {
            batches.insert(id.to_string(), 1);
        }
        batches.insert("stale".to_string(), 1);

        retain_active_client_batches_map(&mut batches, &clients);

        assert_eq!(batches.len(), 9);
        for id in ["a", "b", "c", "d", "e", "f", "g", "h", "i"] {
            assert!(batches.contains_key(id));
        }
        assert!(!batches.contains_key("stale"));
    }
}
