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
