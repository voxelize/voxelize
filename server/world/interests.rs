use std::cmp::Ordering;

use hashbrown::{hash_map::Entry, HashMap, HashSet};

use crate::Vec2;

const REGION_NEIGHBOR_OFFSETS: [(i32, i32); 8] = [
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
];
const SMALL_INTEREST_REGION_SCAN_LIMIT: usize = 8;

#[inline]
fn comparable_weight(weight: Option<&f32>) -> f32 {
    let value = *weight.unwrap_or(&f32::MAX);
    if value.is_finite() {
        value
    } else {
        f32::MAX
    }
}

#[inline]
fn coords_within_region(center: &Vec2<i32>, coords: &Vec2<i32>) -> bool {
    let dx = (i64::from(coords.0) - i64::from(center.0)).unsigned_abs();
    let dz = (i64::from(coords.1) - i64::from(center.1)).unsigned_abs();
    dx <= 1 && dz <= 1
}

#[derive(Debug, Default)]
pub struct ChunkInterests {
    pub map: HashMap<Vec2<i32>, HashSet<String>>,
    pub weights: HashMap<Vec2<i32>, f32>,
}

impl ChunkInterests {
    pub fn new() -> Self {
        Self {
            ..Default::default()
        }
    }

    pub fn is_interested(&self, client_id: &str, coords: &Vec2<i32>) -> bool {
        if let Some(clients) = self.map.get(coords) {
            clients.contains(client_id)
        } else {
            false
        }
    }

    pub fn get_interests(&self, coords: &Vec2<i32>) -> Option<&HashSet<String>> {
        self.map.get(coords)
    }

    pub fn set_weight(&mut self, coords: &Vec2<i32>, weight: f32) {
        self.weights.insert(*coords, weight);
    }

    pub fn get_weight(&self, coords: &Vec2<i32>) -> Option<&f32> {
        self.weights.get(coords)
    }

    pub fn compare(&self, coords_a: &Vec2<i32>, coords_b: &Vec2<i32>) -> Ordering {
        if coords_a == coords_b {
            return Ordering::Equal;
        }
        if self.weights.is_empty() {
            return Ordering::Equal;
        }
        let weight_a = comparable_weight(self.get_weight(coords_a));
        let weight_b = comparable_weight(self.get_weight(coords_b));
        weight_a.total_cmp(&weight_b)
    }

    pub fn has_interests(&self, coords: &Vec2<i32>) -> bool {
        self.map.contains_key(coords)
    }

    pub fn has_interests_in_region(&self, center: &Vec2<i32>) -> bool {
        if self.map.is_empty() {
            return false;
        }
        if self.map.len() <= SMALL_INTEREST_REGION_SCAN_LIMIT {
            for coords in self.map.keys() {
                if coords_within_region(center, coords) {
                    return true;
                }
            }
            return false;
        }
        if self.map.contains_key(center) {
            return true;
        }
        for (dx, dz) in REGION_NEIGHBOR_OFFSETS {
            let Some(nx) = center.0.checked_add(dx) else {
                continue;
            };
            let Some(nz) = center.1.checked_add(dz) else {
                continue;
            };
            if self.map.contains_key(&Vec2(nx, nz)) {
                return true;
            }
        }
        false
    }

    pub fn get_interested_clients_in_region(&self, center: &Vec2<i32>) -> HashSet<String> {
        if self.map.is_empty() {
            return HashSet::new();
        }
        if self.map.len() <= SMALL_INTEREST_REGION_SCAN_LIMIT {
            let mut merged_clients: Option<HashSet<String>> = None;
            let mut single_interest: Option<&HashSet<String>> = None;
            for (coords, interested) in self.map.iter() {
                if !coords_within_region(center, coords) {
                    continue;
                }
                if let Some(clients) = merged_clients.as_mut() {
                    let remaining_capacity = clients.capacity() - clients.len();
                    if remaining_capacity < interested.len() {
                        clients.reserve(interested.len() - remaining_capacity);
                    }
                    clients.extend(interested.iter().cloned());
                    continue;
                }
                if let Some(seed) = single_interest {
                    let mut clients = seed.clone();
                    let remaining_capacity = clients.capacity() - clients.len();
                    if remaining_capacity < interested.len() {
                        clients.reserve(interested.len() - remaining_capacity);
                    }
                    clients.extend(interested.iter().cloned());
                    merged_clients = Some(clients);
                } else {
                    single_interest = Some(interested);
                }
            }
            if let Some(clients) = merged_clients {
                return clients;
            }
            if let Some(interested) = single_interest {
                return interested.clone();
            }
            return HashSet::new();
        }

        let first_interested = self.map.get(center);
        let mut merged_clients: Option<HashSet<String>> = None;
        let mut single_interest = first_interested;
        for (dx, dz) in REGION_NEIGHBOR_OFFSETS {
            let Some(nx) = center.0.checked_add(dx) else {
                continue;
            };
            let Some(nz) = center.1.checked_add(dz) else {
                continue;
            };
            if let Some(interested) = self.map.get(&Vec2(nx, nz)) {
                if let Some(clients) = merged_clients.as_mut() {
                    let remaining_capacity = clients.capacity() - clients.len();
                    if remaining_capacity < interested.len() {
                        clients.reserve(interested.len() - remaining_capacity);
                    }
                    clients.extend(interested.iter().cloned());
                    continue;
                }
                if let Some(seed) = single_interest {
                    let mut clients = seed.clone();
                    let remaining_capacity = clients.capacity() - clients.len();
                    if remaining_capacity < interested.len() {
                        clients.reserve(interested.len() - remaining_capacity);
                    }
                    clients.extend(interested.iter().cloned());
                    merged_clients = Some(clients);
                } else {
                    single_interest = Some(interested);
                }
            }
        }
        if let Some(clients) = merged_clients {
            return clients;
        }
        if let Some(interested) = single_interest {
            return interested.clone();
        }
        HashSet::new()
    }

    pub fn add(&mut self, client_id: &str, coords: &Vec2<i32>) {
        self.add_with_vacancy(client_id, coords);
    }

    #[inline]
    pub fn add_with_vacancy(&mut self, client_id: &str, coords: &Vec2<i32>) -> bool {
        match self.map.entry(*coords) {
            Entry::Occupied(mut entry) => {
                let clients = entry.get_mut();
                clients.get_or_insert_owned(client_id);
                false
            }
            Entry::Vacant(entry) => {
                let mut clients = HashSet::with_capacity(1);
                clients.insert(client_id.to_owned());
                entry.insert(clients);
                true
            }
        }
    }

    pub fn remove(&mut self, client_id: &str, coords: &Vec2<i32>) {
        if let Entry::Occupied(mut entry) = self.map.entry(*coords) {
            let clients = entry.get_mut();
            clients.remove(client_id);
            if clients.is_empty() {
                entry.remove();
                self.weights.remove(coords);
            }
        }
    }

    pub fn add_many(&mut self, client_id: &str, coords: &[Vec2<i32>]) {
        for coord in coords {
            self.add(client_id, coord);
        }
    }

    pub fn remove_many(&mut self, client_id: &str, coords: &[Vec2<i32>]) {
        for coord in coords {
            self.remove(client_id, coord);
        }
    }

    pub fn remove_client(&mut self, client_id: &str) {
        if self.map.is_empty() {
            return;
        }
        if self.map.len() == 1 {
            let Some(coords) = self.map.keys().next().copied() else {
                return;
            };
            let mut should_remove_coords = false;
            if let Some(clients) = self.map.get_mut(&coords) {
                clients.remove(client_id);
                should_remove_coords = clients.is_empty();
            }
            if should_remove_coords {
                self.map.remove(&coords);
                self.weights.remove(&coords);
            }
            return;
        }
        if self.map.len() == 2 {
            let mut coords_iter = self.map.keys().copied();
            let Some(first_coords) = coords_iter.next() else {
                return;
            };
            let Some(second_coords) = coords_iter.next() else {
                return;
            };

            let mut should_remove_first = false;
            if let Some(clients) = self.map.get_mut(&first_coords) {
                clients.remove(client_id);
                should_remove_first = clients.is_empty();
            }
            let mut should_remove_second = false;
            if let Some(clients) = self.map.get_mut(&second_coords) {
                clients.remove(client_id);
                should_remove_second = clients.is_empty();
            }
            if should_remove_first {
                self.map.remove(&first_coords);
                self.weights.remove(&first_coords);
            }
            if should_remove_second {
                self.map.remove(&second_coords);
                self.weights.remove(&second_coords);
            }
            return;
        }
        if self.weights.is_empty() {
            self.map.retain(|_, clients| {
                clients.remove(client_id);
                !clients.is_empty()
            });
            return;
        }
        let mut removed_coords: Option<Vec<Vec2<i32>>> = None;
        self.map.retain(|coords, clients| {
            clients.remove(client_id);
            if clients.is_empty() {
                removed_coords
                    .get_or_insert_with(|| Vec::with_capacity(8))
                    .push(*coords);
                false
            } else {
                true
            }
        });
        if self.map.is_empty() {
            self.weights.clear();
            return;
        }
        if let Some(removed_coords) = removed_coords {
            for coords in removed_coords {
                self.weights.remove(&coords);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use super::{comparable_weight, ChunkInterests};
    use crate::Vec2;

    #[test]
    fn has_interests_in_region_handles_i32_edge_centers() {
        let mut interests = ChunkInterests::new();
        interests.add("a", &Vec2(i32::MAX, i32::MAX));

        assert!(interests.has_interests_in_region(&Vec2(i32::MAX, i32::MAX)));
        assert!(!interests.has_interests_in_region(&Vec2(i32::MIN, i32::MIN)));
    }

    #[test]
    fn has_interests_in_region_handles_single_entry_neighbors() {
        let mut interests = ChunkInterests::new();
        interests.add("a", &Vec2(10, 10));

        assert!(interests.has_interests_in_region(&Vec2(10, 10)));
        assert!(interests.has_interests_in_region(&Vec2(11, 10)));
        assert!(!interests.has_interests_in_region(&Vec2(12, 10)));
    }

    #[test]
    fn has_interests_in_region_handles_two_entry_neighbors() {
        let mut interests = ChunkInterests::new();
        interests.add("a", &Vec2(10, 10));
        interests.add("b", &Vec2(14, 14));

        assert!(interests.has_interests_in_region(&Vec2(11, 11)));
        assert!(!interests.has_interests_in_region(&Vec2(12, 12)));
    }

    #[test]
    fn get_interested_clients_in_region_skips_overflowing_neighbors() {
        let mut interests = ChunkInterests::new();
        interests.add("center", &Vec2(i32::MAX, i32::MAX));
        interests.add("left", &Vec2(i32::MAX - 1, i32::MAX));

        let clients = interests.get_interested_clients_in_region(&Vec2(i32::MAX, i32::MAX));
        assert!(clients.contains("center"));
        assert!(clients.contains("left"));
    }

    #[test]
    fn get_interested_clients_in_region_handles_single_entry_neighbors() {
        let mut interests = ChunkInterests::new();
        interests.add("solo", &Vec2(3, -2));

        let neighbor_clients = interests.get_interested_clients_in_region(&Vec2(4, -2));
        assert_eq!(neighbor_clients.len(), 1);
        assert!(neighbor_clients.contains("solo"));

        let distant_clients = interests.get_interested_clients_in_region(&Vec2(6, -2));
        assert!(distant_clients.is_empty());
    }

    #[test]
    fn get_interested_clients_in_region_handles_two_entry_neighbors() {
        let mut interests = ChunkInterests::new();
        interests.add("near", &Vec2(3, -2));
        interests.add("far", &Vec2(8, -2));

        let near_clients = interests.get_interested_clients_in_region(&Vec2(4, -2));
        assert_eq!(near_clients.len(), 1);
        assert!(near_clients.contains("near"));

        let far_clients = interests.get_interested_clients_in_region(&Vec2(9, -2));
        assert_eq!(far_clients.len(), 1);
        assert!(far_clients.contains("far"));

        let empty_clients = interests.get_interested_clients_in_region(&Vec2(6, -2));
        assert!(empty_clients.is_empty());
    }

    #[test]
    fn get_interested_clients_in_region_dedupes_shared_client_ids() {
        let mut interests = ChunkInterests::new();
        let center = Vec2(0, 0);
        interests.add("shared", &Vec2(0, 0));
        interests.add("shared", &Vec2(1, 0));
        interests.add("other", &Vec2(0, 1));

        let clients = interests.get_interested_clients_in_region(&center);
        assert_eq!(clients.len(), 2);
        assert!(clients.contains("shared"));
        assert!(clients.contains("other"));
    }

    #[test]
    fn add_merges_clients_without_removal_roundtrip() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(2, 3);
        interests.add("a", &coords);
        interests.add("b", &coords);

        let interested = interests
            .get_interests(&coords)
            .expect("expected registered clients");
        assert!(interested.contains("a"));
        assert!(interested.contains("b"));
    }

    #[test]
    fn add_ignores_duplicate_clients_for_same_chunk() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(-1, 7);
        interests.add("a", &coords);
        interests.add("a", &coords);

        let interested = interests
            .get_interests(&coords)
            .expect("expected registered clients");
        assert_eq!(interested.len(), 1);
        assert!(interested.contains("a"));
    }

    #[test]
    fn comparable_weight_clamps_non_finite_values() {
        assert_eq!(comparable_weight(None), f32::MAX);
        assert_eq!(comparable_weight(Some(&f32::INFINITY)), f32::MAX);
        assert_eq!(comparable_weight(Some(&f32::NAN)), f32::MAX);
        assert_eq!(comparable_weight(Some(&12.0)), 12.0);
    }

    #[test]
    fn compare_uses_total_order_for_non_finite_weights() {
        let mut interests = ChunkInterests::new();
        let a = Vec2(0, 0);
        let b = Vec2(1, 1);
        interests.set_weight(&a, f32::NAN);
        interests.set_weight(&b, 1.0);

        assert_eq!(interests.compare(&a, &b), Ordering::Greater);
    }

    #[test]
    fn compare_short_circuits_identical_coords() {
        let interests = ChunkInterests::new();
        let coords = Vec2(12, -9);

        assert_eq!(interests.compare(&coords, &coords), Ordering::Equal);
    }

    #[test]
    fn remove_drops_weight_when_last_client_leaves_chunk() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(4, -2);

        interests.add("a", &coords);
        interests.set_weight(&coords, 9.0);
        interests.remove("a", &coords);

        assert!(!interests.has_interests(&coords));
        assert_eq!(interests.get_weight(&coords), None);
    }

    #[test]
    fn remove_client_clears_weights_for_fully_removed_chunks_only() {
        let mut interests = ChunkInterests::new();
        let removed_coords = Vec2(1, 1);
        let retained_coords = Vec2(2, 2);

        interests.add("a", &removed_coords);
        interests.add("a", &retained_coords);
        interests.add("b", &retained_coords);
        interests.set_weight(&removed_coords, 5.0);
        interests.set_weight(&retained_coords, 7.0);

        interests.remove_client("a");

        assert!(!interests.has_interests(&removed_coords));
        assert!(interests.has_interests(&retained_coords));
        assert_eq!(interests.get_weight(&removed_coords), None);
        assert_eq!(interests.get_weight(&retained_coords), Some(&7.0));
    }

    #[test]
    fn remove_client_handles_single_entry_map() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(3, 4);
        interests.add("solo", &coords);
        interests.set_weight(&coords, 11.0);

        interests.remove_client("solo");

        assert!(!interests.has_interests(&coords));
        assert_eq!(interests.get_weight(&coords), None);
    }

    #[test]
    fn remove_client_keeps_single_entry_when_client_not_present() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(-3, 5);
        interests.add("solo", &coords);
        interests.set_weight(&coords, 3.0);

        interests.remove_client("other");

        assert!(interests.has_interests(&coords));
        assert_eq!(interests.get_weight(&coords), Some(&3.0));
    }

    #[test]
    fn remove_client_handles_two_entry_map_partial_removal() {
        let mut interests = ChunkInterests::new();
        let removed_coords = Vec2(8, 1);
        let retained_coords = Vec2(9, 1);
        interests.add("a", &removed_coords);
        interests.add("a", &retained_coords);
        interests.add("b", &retained_coords);
        interests.set_weight(&removed_coords, 4.0);
        interests.set_weight(&retained_coords, 5.0);

        interests.remove_client("a");

        assert!(!interests.has_interests(&removed_coords));
        assert!(interests.has_interests(&retained_coords));
        assert_eq!(interests.get_weight(&removed_coords), None);
        assert_eq!(interests.get_weight(&retained_coords), Some(&5.0));
    }

    #[test]
    fn remove_client_handles_two_entry_map_full_removal() {
        let mut interests = ChunkInterests::new();
        let first_coords = Vec2(4, 6);
        let second_coords = Vec2(5, 6);
        interests.add("a", &first_coords);
        interests.add("a", &second_coords);
        interests.set_weight(&first_coords, 2.0);
        interests.set_weight(&second_coords, 3.0);

        interests.remove_client("a");

        assert!(!interests.has_interests(&first_coords));
        assert!(!interests.has_interests(&second_coords));
        assert_eq!(interests.get_weight(&first_coords), None);
        assert_eq!(interests.get_weight(&second_coords), None);
    }
}
