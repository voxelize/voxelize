use hashbrown::{HashMap, HashSet};

use crate::Vec2;

#[derive(Debug, Default)]
pub struct ChunkInterests {
    pub map: HashMap<Vec2<i32>, HashSet<String>>,
}

impl ChunkInterests {
    pub fn new() -> Self {
        Self {
            map: HashMap::new(),
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

    pub fn has_interests(&self, coords: &Vec2<i32>) -> bool {
        self.map.contains_key(coords)
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
}
