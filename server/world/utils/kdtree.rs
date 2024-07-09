use kdtree::distance::squared_euclidean;
use kdtree::KdTree as KdTreeCore;

use crate::Vec3;
use specs::Entity;

/// World-wide K-dimensional tree for fast positional querying
///
/// Separated into three searchable sections:
///
/// 1. Union: All entities
/// 2. Players: All players
/// 3. Entities: All entities
#[derive(Debug)]
pub struct KdTree {
    all: KdTreeCore<f32, Entity, Vec<f32>>,
    players: KdTreeCore<f32, Entity, Vec<f32>>,
    entities: KdTreeCore<f32, Entity, Vec<f32>>,
}

impl Default for KdTree {
    fn default() -> Self {
        Self::new()
    }
}

impl KdTree {
    pub fn new() -> Self {
        Self {
            all: KdTreeCore::new(3),
            players: KdTreeCore::new(3),
            entities: KdTreeCore::new(3),
        }
    }

    pub fn reset(&mut self) {
        self.all = KdTreeCore::new(3);
        self.players = KdTreeCore::new(3);
        self.entities = KdTreeCore::new(3);
    }

    pub fn add_player(&mut self, ent: Entity, point: Vec3<f32>) {
        self.players
            .add(vec![point.0, point.1, point.2], ent)
            .expect("Unable to construct KdTree.");

        self.all
            .add(vec![point.0, point.1, point.2], ent)
            .expect("Unable to construct KdTree.");
    }

    pub fn add_entity(&mut self, ent: Entity, point: Vec3<f32>) {
        self.entities
            .add(vec![point.0, point.1, point.2], ent)
            .expect("Unable to construct KdTree.");

        self.all
            .add(vec![point.0, point.1, point.2], ent)
            .expect("Unable to construct KdTree.");
    }

    pub fn search(&self, point: &Vec3<f32>, count: usize) -> Vec<(f32, &Entity)> {
        let mut results = self
            .all
            .nearest(&[point.0, point.1, point.2], count + 1, &squared_euclidean)
            .expect("Unable to search KdTree.");

        if !results.is_empty() {
            results.remove(0);
        }

        results
    }

    pub fn search_player(
        &self,
        point: &Vec3<f32>,
        count: usize,
        is_player: bool,
    ) -> Vec<(f32, &Entity)> {
        let mut results = self
            .players
            .nearest(
                &[point.0, point.1, point.2],
                count + if is_player { 1 } else { 0 },
                &squared_euclidean,
            )
            .expect("Unable to search KdTree.");

        if is_player && !results.is_empty() {
            results.remove(0);
        }

        results
    }

    pub fn search_entity(
        &self,
        point: &Vec3<f32>,
        count: usize,
        is_entity: bool,
    ) -> Vec<(f32, &Entity)> {
        let mut results = self
            .entities
            .nearest(
                &[point.0, point.1, point.2],
                count + if is_entity { 1 } else { 0 },
                &squared_euclidean,
            )
            .expect("Unable to search KdTree.");

        if is_entity && !results.is_empty() {
            results.remove(0);
        }

        results
    }
}
