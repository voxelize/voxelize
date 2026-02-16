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
