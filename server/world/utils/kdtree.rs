use hashbrown::HashMap;
use kiddo::float::kdtree::KdTree as KiddoTree;
use kiddo::SquaredEuclidean;
use specs::Entity;

use crate::Vec3;

type EntityId = u32;

#[derive(Debug)]
struct EntityTree {
    tree: KiddoTree<f32, EntityId, 3, 32, u16>,
    positions: HashMap<EntityId, [f32; 3]>,
}

impl EntityTree {
    fn new() -> Self {
        Self {
            tree: KiddoTree::new(),
            positions: HashMap::new(),
        }
    }

    fn add(&mut self, ent_id: EntityId, pos: [f32; 3]) {
        self.tree.add(&pos, ent_id);
        self.positions.insert(ent_id, pos);
    }

    fn remove(&mut self, ent_id: EntityId) {
        if let Some(pos) = self.positions.remove(&ent_id) {
            self.tree.remove(&pos, ent_id);
        }
    }

    fn update(&mut self, ent_id: EntityId, new_pos: [f32; 3]) {
        if let Some(old_pos) = self.positions.get(&ent_id) {
            self.tree.remove(old_pos, ent_id);
        }
        self.tree.add(&new_pos, ent_id);
        self.positions.insert(ent_id, new_pos);
    }

    fn clear(&mut self) {
        self.tree = KiddoTree::new();
        self.positions.clear();
    }

    fn contains(&self, ent_id: EntityId) -> bool {
        self.positions.contains_key(&ent_id)
    }

    fn nearest(&self, point: &[f32; 3], count: usize) -> Vec<(f32, EntityId)> {
        if self.tree.size() == 0 {
            return Vec::new();
        }
        self.tree
            .nearest_n::<SquaredEuclidean>(point, count)
            .into_iter()
            .map(|n| (n.distance, n.item))
            .collect()
    }

    fn within(&self, point: &[f32; 3], radius_squared: f32) -> Vec<(f32, EntityId)> {
        if self.tree.size() == 0 {
            return Vec::new();
        }
        self.tree
            .within::<SquaredEuclidean>(point, radius_squared)
            .into_iter()
            .map(|n| (n.distance, n.item))
            .collect()
    }

    fn retain<F>(&mut self, mut f: F)
    where
        F: FnMut(EntityId) -> bool,
    {
        let to_remove: Vec<EntityId> = self
            .positions
            .keys()
            .copied()
            .filter(|&id| !f(id))
            .collect();

        for ent_id in to_remove {
            self.remove(ent_id);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EntityKind {
    Player,
    Entity,
}

#[inline]
fn normalized_radius_squared(radius: f32) -> Option<f32> {
    if !radius.is_finite() || radius < 0.0 {
        return None;
    }
    let radius_sq = f64::from(radius) * f64::from(radius);
    if !radius_sq.is_finite() {
        return Some(f32::MAX);
    }
    if radius_sq > f64::from(f32::MAX) {
        return Some(f32::MAX);
    }
    Some(radius_sq as f32)
}

#[inline]
fn is_finite_point(point: &Vec3<f32>) -> bool {
    point.0.is_finite() && point.1.is_finite() && point.2.is_finite()
}

#[inline]
fn point_array_if_finite(point: &Vec3<f32>) -> Option<[f32; 3]> {
    if !is_finite_point(point) {
        return None;
    }
    Some([point.0, point.1, point.2])
}

#[inline]
fn nearest_query_count(count: usize, extra: usize) -> usize {
    count.saturating_add(extra)
}

#[derive(Debug)]
pub struct KdTree {
    all: EntityTree,
    players: EntityTree,
    entities: EntityTree,
    entity_map: HashMap<EntityId, Entity>,
    kind_map: HashMap<EntityId, EntityKind>,
}

impl Default for KdTree {
    fn default() -> Self {
        Self::new()
    }
}

impl KdTree {
    #[inline]
    fn remove_from_kind_tree(&mut self, ent_id: EntityId, kind: EntityKind) {
        match kind {
            EntityKind::Player => self.players.remove(ent_id),
            EntityKind::Entity => self.entities.remove(ent_id),
        }
    }

    #[inline]
    fn remove_entity_by_id(&mut self, ent_id: EntityId) {
        if let Some(kind) = self.kind_map.remove(&ent_id) {
            self.remove_from_kind_tree(ent_id, kind);
        }
        self.all.remove(ent_id);
        self.entity_map.remove(&ent_id);
    }

    pub fn new() -> Self {
        Self {
            all: EntityTree::new(),
            players: EntityTree::new(),
            entities: EntityTree::new(),
            entity_map: HashMap::new(),
            kind_map: HashMap::new(),
        }
    }

    pub fn reset(&mut self) {
        self.all.clear();
        self.players.clear();
        self.entities.clear();
        self.entity_map.clear();
        self.kind_map.clear();
    }

    pub fn add_player(&mut self, ent: Entity, point: Vec3<f32>) {
        let ent_id = ent.id();
        let Some(pos) = point_array_if_finite(&point) else {
            self.remove_entity_by_id(ent_id);
            return;
        };
        match self.kind_map.get(&ent_id).copied() {
            Some(EntityKind::Player) => self.players.update(ent_id, pos),
            Some(EntityKind::Entity) => {
                self.entities.remove(ent_id);
                self.players.add(ent_id, pos);
            }
            None => self.players.add(ent_id, pos),
        }
        self.all.update(ent_id, pos);
        self.entity_map.insert(ent_id, ent);
        self.kind_map.insert(ent_id, EntityKind::Player);
    }

    pub fn add_entity(&mut self, ent: Entity, point: Vec3<f32>) {
        let ent_id = ent.id();
        let Some(pos) = point_array_if_finite(&point) else {
            self.remove_entity_by_id(ent_id);
            return;
        };
        match self.kind_map.get(&ent_id).copied() {
            Some(EntityKind::Entity) => self.entities.update(ent_id, pos),
            Some(EntityKind::Player) => {
                self.players.remove(ent_id);
                self.entities.add(ent_id, pos);
            }
            None => self.entities.add(ent_id, pos),
        }
        self.all.update(ent_id, pos);
        self.entity_map.insert(ent_id, ent);
        self.kind_map.insert(ent_id, EntityKind::Entity);
    }

    pub fn update_player(&mut self, ent: Entity, point: Vec3<f32>) {
        self.add_player(ent, point);
    }

    pub fn update_entity(&mut self, ent: Entity, point: Vec3<f32>) {
        self.add_entity(ent, point);
    }

    pub fn remove_player(&mut self, ent: Entity) {
        self.remove_entity_by_id(ent.id());
    }

    pub fn remove_entity(&mut self, ent: Entity) {
        self.remove_entity_by_id(ent.id());
    }

    pub fn contains(&self, ent: Entity) -> bool {
        self.entity_map.contains_key(&ent.id())
    }

    pub fn contains_player(&self, ent: Entity) -> bool {
        self.kind_map.get(&ent.id()) == Some(&EntityKind::Player)
    }

    pub fn contains_entity(&self, ent: Entity) -> bool {
        self.kind_map.get(&ent.id()) == Some(&EntityKind::Entity)
    }

    pub fn get_position(&self, ent: Entity) -> Option<[f32; 3]> {
        self.all.positions.get(&ent.id()).copied()
    }

    pub fn retain<F>(&mut self, f: F)
    where
        F: Fn(EntityId) -> bool,
    {
        let to_remove: Vec<(EntityId, EntityKind)> = self
            .kind_map
            .iter()
            .filter(|(&id, _)| !f(id))
            .map(|(&id, &kind)| (id, kind))
            .collect();

        for (ent_id, _) in to_remove {
            self.remove_entity_by_id(ent_id);
        }
    }

    pub fn search(&self, point: &Vec3<f32>, count: usize) -> Vec<(f32, &Entity)> {
        if !is_finite_point(point) {
            return Vec::new();
        }
        let results = self
            .all
            .nearest(&[point.0, point.1, point.2], nearest_query_count(count, 1));
        results
            .into_iter()
            .skip(1)
            .filter_map(|(dist, ent_id)| self.entity_map.get(&ent_id).map(|e| (dist, e)))
            .collect()
    }

    pub fn search_player(
        &self,
        point: &Vec3<f32>,
        count: usize,
        is_player: bool,
    ) -> Vec<(f32, &Entity)> {
        if !is_finite_point(point) {
            return Vec::new();
        }
        let skip = if is_player { 1 } else { 0 };
        let results = self
            .players
            .nearest(&[point.0, point.1, point.2], nearest_query_count(count, skip));
        results
            .into_iter()
            .skip(skip)
            .filter_map(|(dist, ent_id)| self.entity_map.get(&ent_id).map(|e| (dist, e)))
            .collect()
    }

    pub fn search_entity(
        &self,
        point: &Vec3<f32>,
        count: usize,
        is_entity: bool,
    ) -> Vec<(f32, &Entity)> {
        if !is_finite_point(point) {
            return Vec::new();
        }
        let skip = if is_entity { 1 } else { 0 };
        let results = self
            .entities
            .nearest(&[point.0, point.1, point.2], nearest_query_count(count, skip));
        results
            .into_iter()
            .skip(skip)
            .filter_map(|(dist, ent_id)| self.entity_map.get(&ent_id).map(|e| (dist, e)))
            .collect()
    }

    pub fn players_within_radius(&self, point: &Vec3<f32>, radius: f32) -> Vec<&Entity> {
        if !is_finite_point(point) {
            return Vec::new();
        }
        let Some(radius_squared) = normalized_radius_squared(radius) else {
            return Vec::new();
        };
        let results = self
            .players
            .within(&[point.0, point.1, point.2], radius_squared);
        results
            .into_iter()
            .filter_map(|(_, ent_id)| self.entity_map.get(&ent_id))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_finite_point, nearest_query_count, normalized_radius_squared, point_array_if_finite,
    };
    use crate::Vec3;

    #[test]
    fn normalized_radius_squared_rejects_invalid_inputs() {
        assert_eq!(normalized_radius_squared(-1.0), None);
        assert_eq!(normalized_radius_squared(f32::NAN), None);
    }

    #[test]
    fn normalized_radius_squared_clamps_large_values() {
        assert_eq!(normalized_radius_squared(2.0), Some(4.0));
        assert_eq!(normalized_radius_squared(f32::MAX), Some(f32::MAX));
        assert_eq!(normalized_radius_squared(f32::INFINITY), None);
    }

    #[test]
    fn is_finite_point_rejects_non_finite_coordinates() {
        assert!(is_finite_point(&Vec3(1.0, 2.0, 3.0)));
        assert!(!is_finite_point(&Vec3(f32::NAN, 2.0, 3.0)));
        assert!(!is_finite_point(&Vec3(1.0, f32::INFINITY, 3.0)));
        assert!(!is_finite_point(&Vec3(1.0, 2.0, f32::NEG_INFINITY)));
    }

    #[test]
    fn nearest_query_count_saturates_at_usize_max() {
        assert_eq!(nearest_query_count(2, 1), 3);
        assert_eq!(nearest_query_count(usize::MAX, 1), usize::MAX);
    }

    #[test]
    fn point_array_if_finite_requires_finite_coordinates() {
        assert_eq!(point_array_if_finite(&Vec3(1.0, 2.0, 3.0)), Some([1.0, 2.0, 3.0]));
        assert_eq!(point_array_if_finite(&Vec3(f32::NAN, 2.0, 3.0)), None);
    }
}
