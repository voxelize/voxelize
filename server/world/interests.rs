use std::cmp::Ordering;

use hashbrown::{HashMap, HashSet};

use crate::Vec2;

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
        self.weights.insert(coords.to_owned(), weight);
    }

    pub fn get_weight(&self, coords: &Vec2<i32>) -> Option<&f32> {
        self.weights.get(coords)
    }

    pub fn compare(&self, coords_a: &Vec2<i32>, coords_b: &Vec2<i32>) -> Ordering {
        let weight_a = self.get_weight(coords_a).unwrap_or(&f32::MAX);
        let weight_b = self.get_weight(coords_b).unwrap_or(&f32::MAX);

        weight_a.partial_cmp(weight_b).unwrap_or(Ordering::Equal)
    }

    pub fn has_interests(&self, coords: &Vec2<i32>) -> bool {
        self.map.contains_key(coords)
    }

    pub fn has_interests_in_region(&self, center: &Vec2<i32>) -> bool {
        for dx in -1..=1 {
            let Some(nx) = center.0.checked_add(dx) else {
                continue;
            };
            for dz in -1..=1 {
                let Some(nz) = center.1.checked_add(dz) else {
                    continue;
                };
                let coords = Vec2(nx, nz);
                if self.has_interests(&coords) {
                    return true;
                }
            }
        }
        false
    }

    pub fn get_interested_clients_in_region(&self, center: &Vec2<i32>) -> HashSet<String> {
        let mut clients = HashSet::new();
        for dx in -1..=1 {
            let Some(nx) = center.0.checked_add(dx) else {
                continue;
            };
            for dz in -1..=1 {
                let Some(nz) = center.1.checked_add(dz) else {
                    continue;
                };
                let coords = Vec2(nx, nz);
                if let Some(interested) = self.get_interests(&coords) {
                    clients.extend(interested.iter().cloned());
                }
            }
        }
        clients
    }

    pub fn add(&mut self, client_id: &str, coords: &Vec2<i32>) {
        self.map
            .entry(coords.to_owned())
            .or_default()
            .insert(client_id.to_owned());
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
        self.map.retain(|_, clients| {
            clients.remove(client_id);
            !clients.is_empty()
        });
    }
}

#[cfg(test)]
mod tests {
    use super::ChunkInterests;
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
}
