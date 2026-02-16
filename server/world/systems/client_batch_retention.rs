use hashbrown::HashMap;

use crate::Clients;

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
            if let Some((single_client_id, _)) = clients.iter().next() {
                let single_client_id = single_client_id.as_str();
                batches.retain(|client_id, _| client_id.as_str() == single_client_id);
            } else {
                batches.clear();
            }
        }
        2 => {
            let mut client_ids = clients.keys();
            let Some(first_client_id) = client_ids.next().map(String::as_str) else {
                batches.clear();
                return;
            };
            let Some(second_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| client_id.as_str() == first_client_id);
                return;
            };
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id || client_id == second_client_id
            });
        }
        3 => {
            let mut client_ids = clients.keys();
            let Some(first_client_id) = client_ids.next().map(String::as_str) else {
                batches.clear();
                return;
            };
            let Some(second_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| client_id.as_str() == first_client_id);
                return;
            };
            let Some(third_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id || client_id == second_client_id
                });
                return;
            };
            batches.retain(|client_id, _| {
                let client_id = client_id.as_str();
                client_id == first_client_id
                    || client_id == second_client_id
                    || client_id == third_client_id
            });
        }
        4 => {
            let mut client_ids = clients.keys();
            let Some(first_client_id) = client_ids.next().map(String::as_str) else {
                batches.clear();
                return;
            };
            let Some(second_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| client_id.as_str() == first_client_id);
                return;
            };
            let Some(third_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id || client_id == second_client_id
                });
                return;
            };
            let Some(fourth_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id
                        || client_id == second_client_id
                        || client_id == third_client_id
                });
                return;
            };
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
            let Some(first_client_id) = client_ids.next().map(String::as_str) else {
                batches.clear();
                return;
            };
            let Some(second_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| client_id.as_str() == first_client_id);
                return;
            };
            let Some(third_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id || client_id == second_client_id
                });
                return;
            };
            let Some(fourth_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id
                        || client_id == second_client_id
                        || client_id == third_client_id
                });
                return;
            };
            let Some(fifth_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id
                        || client_id == second_client_id
                        || client_id == third_client_id
                        || client_id == fourth_client_id
                });
                return;
            };
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
            let Some(first_client_id) = client_ids.next().map(String::as_str) else {
                batches.clear();
                return;
            };
            let Some(second_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| client_id.as_str() == first_client_id);
                return;
            };
            let Some(third_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id || client_id == second_client_id
                });
                return;
            };
            let Some(fourth_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id
                        || client_id == second_client_id
                        || client_id == third_client_id
                });
                return;
            };
            let Some(fifth_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id
                        || client_id == second_client_id
                        || client_id == third_client_id
                        || client_id == fourth_client_id
                });
                return;
            };
            let Some(sixth_client_id) = client_ids.next().map(String::as_str) else {
                batches.retain(|client_id, _| {
                    let client_id = client_id.as_str();
                    client_id == first_client_id
                        || client_id == second_client_id
                        || client_id == third_client_id
                        || client_id == fourth_client_id
                        || client_id == fifth_client_id
                });
                return;
            };
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
        _ => {
            batches.retain(|client_id, _| clients.contains_key(client_id));
        }
    }
}
