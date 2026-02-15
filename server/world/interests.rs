use std::cmp::Ordering;

use hashbrown::{hash_map::Entry, HashMap, HashSet};

use crate::Vec2;

#[inline]
fn comparable_weight(weight: Option<&f32>) -> f32 {
    let value = *weight.unwrap_or(&f32::MAX);
    if value.is_finite() {
        value
    } else {
        f32::MAX
    }
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
        self.map
            .get(coords)
            .map(|clients| clients.contains(client_id))
            .unwrap_or(false)
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
        for dx in -1..=1 {
            let Some(nx) = center.0.checked_add(dx) else {
                continue;
            };
            for dz in -1..=1 {
                let Some(nz) = center.1.checked_add(dz) else {
                    continue;
                };
                if self.map.contains_key(&Vec2(nx, nz)) {
                    return true;
                }
            }
        }
        false
    }

    pub fn get_interested_clients_in_region(&self, center: &Vec2<i32>) -> HashSet<String> {
        if self.map.is_empty() {
            return HashSet::new();
        }

        let mut interested_sets = Vec::with_capacity(9);
        let mut expected_clients = 0usize;
        for dx in -1..=1 {
            let Some(nx) = center.0.checked_add(dx) else {
                continue;
            };
            for dz in -1..=1 {
                let Some(nz) = center.1.checked_add(dz) else {
                    continue;
                };
                if let Some(interested) = self.get_interests(&Vec2(nx, nz)) {
                    expected_clients = expected_clients.saturating_add(interested.len());
                    interested_sets.push(interested);
                }
            }
        }
        if expected_clients == 0 {
            return HashSet::new();
        }
        if interested_sets.len() == 1 {
            return interested_sets[0].iter().cloned().collect();
        }

        let mut clients = HashSet::with_capacity(expected_clients);
        for interested in interested_sets {
            clients.extend(interested.iter().cloned());
        }
        clients
    }

    pub fn add(&mut self, client_id: &str, coords: &Vec2<i32>) {
        match self.map.entry(*coords) {
            Entry::Occupied(mut entry) => {
                let clients = entry.get_mut();
                if clients.contains(client_id) {
                    return;
                }
                clients.insert(client_id.to_owned());
            }
            Entry::Vacant(entry) => {
                let mut clients = HashSet::with_capacity(1);
                clients.insert(client_id.to_owned());
                entry.insert(clients);
            }
        }
    }

    pub fn remove(&mut self, client_id: &str, coords: &Vec2<i32>) {
        if let Some(clients) = self.map.get_mut(coords) {
            clients.remove(client_id);

            if clients.is_empty() {
                self.map.remove(coords);
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
        self.map.retain(|_, clients| {
            clients.remove(client_id);
            !clients.is_empty()
        });
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
    fn get_interested_clients_in_region_skips_overflowing_neighbors() {
        let mut interests = ChunkInterests::new();
        interests.add("center", &Vec2(i32::MAX, i32::MAX));
        interests.add("left", &Vec2(i32::MAX - 1, i32::MAX));

        let clients = interests.get_interested_clients_in_region(&Vec2(i32::MAX, i32::MAX));
        assert!(clients.contains("center"));
        assert!(clients.contains("left"));
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
}
