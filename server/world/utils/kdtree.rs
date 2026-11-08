use hashbrown::HashMap;
use kiddo::float::kdtree::KdTree as KiddoTree;
use kiddo::SquaredEuclidean;
use specs::Entity;

use crate::Vec3;

type EntityId = u32;

/// Where an entity sits in the tree: its position nudged by a few float
/// steps per axis, picked from its id.
///
/// kiddo cannot split a full leaf whose points share one value on the
/// split axis: past the bucket size it panics ("Too many items with the
/// same position on one axis"), and the panic takes the whole world's
/// actor down with it. A world full of things set on one floor, or lined up
/// along one wall, has hundreds of entities at exactly the same y or x. The
/// nudge (at most 15 steps of a few ulps, under a hundredth of a block
/// within a thousand blocks of the origin) makes ties vanish while keeping
/// every query's answer to well inside a voxel; `positions` keeps the exact
/// value for callers.
fn tree_key(ent_id: EntityId, pos: [f32; 3]) -> [f32; 3] {
    let mut h = ent_id.wrapping_mul(0x9E37_79B1) ^ 0x85EB_CA6B;
    let mut out = pos;
    for v in out.iter_mut() {
        h ^= h >> 15;
        h = h.wrapping_mul(0x2C1B_3C6D);
        h ^= h >> 12;
        let level = (h & 15) as f32;
        // Four ulps of the value's own magnitude: never rounds away.
        let step = v.abs().max(1.0) * f32::EPSILON * 4.0;
        *v += level * step;
    }
    out
}

#[derive(Debug)]
struct EntityTree {
    tree: KiddoTree<f32, EntityId, 3, 256, u16>,
    positions: HashMap<EntityId, [f32; 3]>,
    /// The nudged point each entity was filed under (`tree_key`).
    keys: HashMap<EntityId, [f32; 3]>,
}

impl EntityTree {
    fn new() -> Self {
        Self {
            tree: KiddoTree::new(),
            positions: HashMap::new(),
            keys: HashMap::new(),
        }
    }

    fn add(&mut self, ent_id: EntityId, pos: [f32; 3]) {
        if let Some(old) = self.keys.remove(&ent_id) {
            self.tree.remove(&old, ent_id);
        }
        let key = tree_key(ent_id, pos);
        self.tree.add(&key, ent_id);
        self.keys.insert(ent_id, key);
        self.positions.insert(ent_id, pos);
    }

    fn remove(&mut self, ent_id: EntityId) {
        self.positions.remove(&ent_id);
        if let Some(key) = self.keys.remove(&ent_id) {
            self.tree.remove(&key, ent_id);
        }
    }

    fn update(&mut self, ent_id: EntityId, new_pos: [f32; 3]) {
        self.add(ent_id, new_pos);
    }

    fn clear(&mut self) {
        self.tree = KiddoTree::new();
        self.positions.clear();
        self.keys.clear();
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
        let pos = [point.0, point.1, point.2];
        self.players.add(ent_id, pos);
        self.all.add(ent_id, pos);
        self.entity_map.insert(ent_id, ent);
        self.kind_map.insert(ent_id, EntityKind::Player);
    }

    pub fn add_entity(&mut self, ent: Entity, point: Vec3<f32>) {
        let ent_id = ent.id();
        let pos = [point.0, point.1, point.2];
        self.entities.add(ent_id, pos);
        self.all.add(ent_id, pos);
        self.entity_map.insert(ent_id, ent);
        self.kind_map.insert(ent_id, EntityKind::Entity);
    }

    pub fn update_player(&mut self, ent: Entity, point: Vec3<f32>) {
        let ent_id = ent.id();
        let pos = [point.0, point.1, point.2];
        self.players.update(ent_id, pos);
        self.all.update(ent_id, pos);
    }

    pub fn update_entity(&mut self, ent: Entity, point: Vec3<f32>) {
        let ent_id = ent.id();
        let pos = [point.0, point.1, point.2];
        self.entities.update(ent_id, pos);
        self.all.update(ent_id, pos);
    }

    pub fn remove_player(&mut self, ent: Entity) {
        let ent_id = ent.id();
        self.players.remove(ent_id);
        self.all.remove(ent_id);
        self.entity_map.remove(&ent_id);
        self.kind_map.remove(&ent_id);
    }

    pub fn remove_entity(&mut self, ent: Entity) {
        let ent_id = ent.id();
        self.entities.remove(ent_id);
        self.all.remove(ent_id);
        self.entity_map.remove(&ent_id);
        self.kind_map.remove(&ent_id);
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

        for (ent_id, kind) in to_remove {
            match kind {
                EntityKind::Player => {
                    self.players.remove(ent_id);
                }
                EntityKind::Entity => {
                    self.entities.remove(ent_id);
                }
            }
            self.all.remove(ent_id);
            self.entity_map.remove(&ent_id);
            self.kind_map.remove(&ent_id);
        }
    }

    pub fn search(&self, point: &Vec3<f32>, count: usize) -> Vec<(f32, &Entity)> {
        let results = self.all.nearest(&[point.0, point.1, point.2], count + 1);
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
        let skip = if is_player { 1 } else { 0 };
        let results = self
            .players
            .nearest(&[point.0, point.1, point.2], count + skip);
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
        let skip = if is_entity { 1 } else { 0 };
        let results = self
            .entities
            .nearest(&[point.0, point.1, point.2], count + skip);
        results
            .into_iter()
            .skip(skip)
            .filter_map(|(dist, ent_id)| self.entity_map.get(&ent_id).map(|e| (dist, e)))
            .collect()
    }

    pub fn players_within_radius(&self, point: &Vec3<f32>, radius: f32) -> Vec<&Entity> {
        let radius_squared = radius * radius;
        let results = self
            .players
            .within(&[point.0, point.1, point.2], radius_squared);
        results
            .into_iter()
            .filter_map(|(_, ent_id)| self.entity_map.get(&ent_id))
            .collect()
    }

    pub fn entities_within_radius(&self, point: &Vec3<f32>, radius: f32) -> Vec<(f32, &Entity)> {
        let radius_squared = radius * radius;
        let results = self
            .entities
            .within(&[point.0, point.1, point.2], radius_squared);
        results
            .into_iter()
            .filter_map(|(dist_sq, ent_id)| self.entity_map.get(&ent_id).map(|e| (dist_sq, e)))
            .collect()
    }

    /// Every tracked entity AND player within `radius` of `point`. Area
    /// effects (blasts, suction fields) use this so clients are never
    /// silently excluded the way the entities-only radius query excludes
    /// them.
    pub fn all_within_radius(&self, point: &Vec3<f32>, radius: f32) -> Vec<(f32, &Entity)> {
        let radius_squared = radius * radius;
        let results = self
            .all
            .within(&[point.0, point.1, point.2], radius_squared);
        results
            .into_iter()
            .filter_map(|(dist_sq, ent_id)| self.entity_map.get(&ent_id).map(|e| (dist_sq, e)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Thousands of things standing on one floor, many along one wall:
    /// filing them all, moving some and finding them again must not panic
    /// (kiddo's "Too many items with the same position on one axis").
    #[test]
    fn many_entities_on_one_plane_do_not_panic() {
        let mut tree = EntityTree::new();
        let mut id = 0u32;
        for x in 0..40 {
            for z in 0..120 {
                let wall_x = if z % 3 == 0 { 512.38 } else { 512.0 + x as f32 };
                tree.add(id, [wall_x, 25.0, 300.0 + z as f32 * 0.5]);
                id += 1;
            }
        }
        for i in (0..id).step_by(7) {
            tree.update(i, [512.38, 25.0, 1.0]);
        }
        let near = tree.within(&[512.38, 25.0, 1.0], 0.01);
        assert_eq!(near.len(), (0..id).step_by(7).count());
        for i in 0..id {
            tree.remove(i);
        }
        assert_eq!(tree.tree.size(), 0);
    }

    #[test]
    fn exact_positions_are_kept_for_callers() {
        let mut tree = EntityTree::new();
        tree.add(9, [1000.5, 40.0, -2000.25]);
        assert_eq!(tree.positions.get(&9), Some(&[1000.5, 40.0, -2000.25]));
        let key = tree.keys[&9];
        for a in 0..3 {
            assert!((key[a] - [1000.5f32, 40.0, -2000.25][a]).abs() < 0.02);
        }
    }
}
