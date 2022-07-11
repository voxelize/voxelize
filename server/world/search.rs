use kdtree::distance::squared_euclidean;
use kdtree::KdTree as KdTreeCore;
use specs::Entity;

use crate::Vec3;

/// World-wide K-dimensional tree for fast positional querying
///
/// Separated into three searchable sections:
///
/// 1. All: All entities
/// 2. Clients: All clients
/// 3. Entities: All entities
#[derive(Debug)]
pub struct Search {
    all: KdTreeCore<f32, Entity, Vec<f32>>,
    clients: KdTreeCore<f32, Entity, Vec<f32>>,
    entities: KdTreeCore<f32, Entity, Vec<f32>>,
}

impl Default for Search {
    fn default() -> Self {
        Self::new()
    }
}

impl Search {
    pub fn new() -> Self {
        Self {
            all: KdTreeCore::new(3),
            clients: KdTreeCore::new(3),
            entities: KdTreeCore::new(3),
        }
    }

    pub fn reset(&mut self) {
        self.all = KdTreeCore::new(3);
        self.clients = KdTreeCore::new(3);
        self.entities = KdTreeCore::new(3);
    }

    pub fn add_client(&mut self, ent: Entity, point: Vec3<f32>) {
        self.clients
            .add(vec![point.0, point.1, point.2], ent)
            .expect("Unable to construct KdTree.");

        self.all
            .add(vec![point.0, point.1, point.2], ent)
            .expect("Unable to construct KdTree.");
    }

    pub fn add_entity(&mut self, ent: Entity, point: Vec3<f32>) {
        self.entities
            .add(vec![point.0, point.1, point.2], ent)
            .expect("Unable to construct tree.");

        self.all
            .add(vec![point.0, point.1, point.2], ent)
            .expect("Unable to construct tree.");
    }

    pub fn within(&self, point: &Vec3<f32>, radius: f32) -> Vec<(f32, &Entity)> {
        self.all
            .within(&[point.0, point.1, point.2], radius, &squared_euclidean)
            .expect("Unable to search tree.")
            .into_iter()
            .collect::<Vec<_>>()
    }

    pub fn within_entity(
        &self,
        point: &Vec3<f32>,
        from: &Entity,
        radius: f32,
    ) -> Vec<(f32, &Entity)> {
        self.all
            .within(&[point.0, point.1, point.2], radius, &squared_euclidean)
            .expect("Unable to search tree.")
            .into_iter()
            .filter(|(_, &ent)| ent.id() != from.id())
            .collect::<Vec<_>>()
    }

    pub fn search(&self, point: &Vec3<f32>, count: usize) -> Vec<(f32, &Entity)> {
        self.all
            .nearest(&[point.0, point.1, point.2], count + 1, &squared_euclidean)
            .expect("Unable to search tree.")
    }
}
