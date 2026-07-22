use std::cmp::Ordering;

use hashbrown::{HashMap, HashSet};

use crate::Vec2;

#[derive(Debug, Default)]
pub struct ChunkInterests {
    pub map: HashMap<Vec2<i32>, HashSet<String>>,
    pub weights: HashMap<Vec2<i32>, f32>,

    /// Which clients want a chunk as a reduced-detail mesh, and at which LOD
    /// level. A client in `map` but absent here wants the full chunk (data
    /// and/or full meshes); a client present here receives only the compact
    /// LOD mesh for that chunk. Kept consistent with `map`: removing a
    /// client's interest also clears its LOD level.
    pub lod_levels: HashMap<Vec2<i32>, HashMap<String, u32>>,
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
            for dz in -1..=1 {
                let coords = Vec2(center.0 + dx, center.1 + dz);
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
            for dz in -1..=1 {
                let coords = Vec2(center.0 + dx, center.1 + dz);
                if let Some(interested) = self.get_interests(&coords) {
                    clients.extend(interested.iter().cloned());
                }
            }
        }
        clients
    }

    pub fn add(&mut self, client_id: &str, coords: &Vec2<i32>) {
        let mut clients = self.map.remove(coords).unwrap_or_default();
        clients.insert(client_id.to_owned());
        self.map.insert(coords.to_owned(), clients);
        self.clear_lod(client_id, coords);
    }

    /// Register interest in a chunk as a reduced-detail mesh at `level`.
    /// Supersedes any full-form interest the client held for the chunk.
    pub fn add_lod(&mut self, client_id: &str, coords: &Vec2<i32>, level: u32) {
        let mut clients = self.map.remove(coords).unwrap_or_default();
        clients.insert(client_id.to_owned());
        self.map.insert(coords.to_owned(), clients);

        self.lod_levels
            .entry(coords.to_owned())
            .or_default()
            .insert(client_id.to_owned(), level);
    }

    /// The LOD level a client wants a chunk at, or `None` for the full form.
    pub fn get_lod(&self, client_id: &str, coords: &Vec2<i32>) -> Option<u32> {
        self.lod_levels
            .get(coords)
            .and_then(|levels| levels.get(client_id))
            .copied()
    }

    fn clear_lod(&mut self, client_id: &str, coords: &Vec2<i32>) {
        if let Some(levels) = self.lod_levels.get_mut(coords) {
            levels.remove(client_id);
            if levels.is_empty() {
                self.lod_levels.remove(coords);
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

        self.clear_lod(client_id, coords);
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
        self.lod_levels.retain(|_, levels| {
            levels.remove(client_id);
            !levels.is_empty()
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lod_interest_is_tracked_per_client_and_level() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(3, -2);

        interests.add_lod("a", &coords, 1);
        interests.add_lod("b", &coords, 2);

        assert!(interests.is_interested("a", &coords));
        assert_eq!(interests.get_lod("a", &coords), Some(1));
        assert_eq!(interests.get_lod("b", &coords), Some(2));
    }

    #[test]
    fn full_interest_supersedes_lod_interest() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(0, 0);

        interests.add_lod("a", &coords, 2);
        interests.add("a", &coords);

        assert!(interests.is_interested("a", &coords));
        assert_eq!(interests.get_lod("a", &coords), None);
    }

    #[test]
    fn lod_interest_supersedes_full_interest() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(0, 0);

        interests.add("a", &coords);
        interests.add_lod("a", &coords, 3);

        assert_eq!(interests.get_lod("a", &coords), Some(3));
    }

    #[test]
    fn removal_clears_both_forms() {
        let mut interests = ChunkInterests::new();
        let coords = Vec2(1, 1);

        interests.add_lod("a", &coords, 1);
        interests.remove("a", &coords);

        assert!(!interests.has_interests(&coords));
        assert_eq!(interests.get_lod("a", &coords), None);
        assert!(interests.lod_levels.is_empty());
    }

    #[test]
    fn remove_client_clears_lod_levels() {
        let mut interests = ChunkInterests::new();

        interests.add_lod("a", &Vec2(0, 0), 1);
        interests.add_lod("b", &Vec2(0, 0), 2);
        interests.remove_client("a");

        assert_eq!(interests.get_lod("a", &Vec2(0, 0)), None);
        assert_eq!(interests.get_lod("b", &Vec2(0, 0)), Some(2));
    }
}
