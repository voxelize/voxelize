use hashbrown::{hash_map::Entry, HashMap};
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
        match self.positions.entry(ent_id) {
            Entry::Occupied(mut entry) => {
                if entry.get() == &new_pos {
                    return;
                }
                let old_pos = *entry.get();
                self.tree.remove(&old_pos, ent_id);
                self.tree.add(&new_pos, ent_id);
                *entry.get_mut() = new_pos;
            }
            Entry::Vacant(entry) => {
                self.tree.add(&new_pos, ent_id);
                entry.insert(new_pos);
            }
        }
    }

    fn clear(&mut self) {
        self.tree = KiddoTree::new();
        self.positions.clear();
    }

    fn for_each_nearest<F>(&self, point: &[f32; 3], count: usize, mut f: F)
    where
        F: FnMut(f32, EntityId),
    {
        if self.tree.size() == 0 {
            return;
        }
        let query_count = count.min(self.tree.size() as usize);
        if query_count == 0 {
            return;
        }
        for entry in self.tree.nearest_n::<SquaredEuclidean>(point, query_count) {
            f(entry.distance, entry.item);
        }
    }

    fn for_each_within_id<F>(&self, point: &[f32; 3], radius_squared: f32, mut f: F)
    where
        F: FnMut(EntityId),
    {
        if self.tree.size() == 0 {
            return;
        }
        for entry in self.tree.within::<SquaredEuclidean>(point, radius_squared) {
            f(entry.item);
        }
    }

    fn first_nearest_item(
        &self,
        point: &[f32; 3],
        query_count: usize,
        skip: usize,
    ) -> Option<EntityId> {
        if self.tree.size() == 0 {
            return None;
        }
        if skip == 0 {
            return Some(self.tree.nearest_one::<SquaredEuclidean>(point).item);
        }
        let clamped_count = query_count.min(self.tree.size() as usize);
        if clamped_count <= skip {
            return None;
        }
        let nearest = self.tree.nearest_n::<SquaredEuclidean>(point, clamped_count);
        nearest.get(skip).map(|entry| entry.item)
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
    removal_buffer: Vec<EntityId>,
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

    #[inline]
    fn get_position_if_kind(&self, ent: Entity, kind: EntityKind) -> Option<[f32; 3]> {
        if self.kind_map.get(&ent.id()) != Some(&kind) {
            return None;
        }
        self.all.positions.get(&ent.id()).copied()
    }

    pub fn new() -> Self {
        Self {
            all: EntityTree::new(),
            players: EntityTree::new(),
            entities: EntityTree::new(),
            entity_map: HashMap::new(),
            kind_map: HashMap::new(),
            removal_buffer: Vec::new(),
        }
    }

    pub fn reset(&mut self) {
        self.all.clear();
        self.players.clear();
        self.entities.clear();
        self.entity_map.clear();
        self.kind_map.clear();
        self.removal_buffer.clear();
    }

    pub fn add_player(&mut self, ent: Entity, point: &Vec3<f32>) {
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

    pub fn add_entity(&mut self, ent: Entity, point: &Vec3<f32>) {
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

    pub fn update_player(&mut self, ent: Entity, point: &Vec3<f32>) {
        self.add_player(ent, point);
    }

    pub fn update_entity(&mut self, ent: Entity, point: &Vec3<f32>) {
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

    pub fn get_player_position(&self, ent: Entity) -> Option<[f32; 3]> {
        self.get_position_if_kind(ent, EntityKind::Player)
    }

    pub fn get_entity_position(&self, ent: Entity) -> Option<[f32; 3]> {
        self.get_position_if_kind(ent, EntityKind::Entity)
    }

    pub fn len(&self) -> usize {
        self.entity_map.len()
    }

    pub fn get_position(&self, ent: Entity) -> Option<[f32; 3]> {
        self.all.positions.get(&ent.id()).copied()
    }

    pub fn retain<F>(&mut self, f: F)
    where
        F: Fn(EntityId) -> bool,
    {
        let mut to_remove = std::mem::take(&mut self.removal_buffer);
        to_remove.clear();
        if to_remove.capacity() < self.kind_map.len() {
            to_remove.reserve(self.kind_map.len() - to_remove.capacity());
        }
        for (&id, _) in self.kind_map.iter() {
            if !f(id) {
                to_remove.push(id);
            }
        }

        for &ent_id in &to_remove {
            self.remove_entity_by_id(ent_id);
        }
        self.removal_buffer = to_remove;
    }

    pub fn search(&self, point: &Vec3<f32>, count: usize) -> Vec<(f32, &Entity)> {
        if count == 0 {
            return Vec::new();
        }
        let Some(query_point) = point_array_if_finite(point) else {
            return Vec::new();
        };
        let tree_size = self.all.tree.size() as usize;
        if tree_size <= 1 {
            return Vec::new();
        }
        let max_results = count.min(tree_size - 1);
        let mut entities = Vec::with_capacity(max_results);
        let mut skipped = 0usize;
        self.all
            .for_each_nearest(&query_point, nearest_query_count(count, 1), |dist, ent_id| {
                if skipped < 1 {
                    skipped += 1;
                    return;
                }
                if let Some(entity) = self.entity_map.get(&ent_id) {
                    entities.push((dist, entity));
                }
            });
        entities
    }

    pub fn search_first(&self, point: &Vec3<f32>) -> Option<&Entity> {
        let Some(query_point) = point_array_if_finite(point) else {
            return None;
        };
        let query_count = nearest_query_count(1, 1);
        let ent_id = self.all.first_nearest_item(&query_point, query_count, 1)?;
        self.entity_map.get(&ent_id)
    }

    pub fn search_player(
        &self,
        point: &Vec3<f32>,
        count: usize,
        is_player: bool,
    ) -> Vec<(f32, &Entity)> {
        if count == 0 {
            return Vec::new();
        }
        let Some(query_point) = point_array_if_finite(point) else {
            return Vec::new();
        };
        let skip = if is_player { 1 } else { 0 };
        let tree_size = self.players.tree.size() as usize;
        if tree_size <= skip {
            return Vec::new();
        }
        let max_results = count.min(tree_size - skip);
        let mut entities = Vec::with_capacity(max_results);
        let mut skipped = 0usize;
        self.players
            .for_each_nearest(&query_point, nearest_query_count(count, skip), |dist, ent_id| {
                if skipped < skip {
                    skipped += 1;
                    return;
                }
                if let Some(entity) = self.entity_map.get(&ent_id) {
                    entities.push((dist, entity));
                }
            });
        entities
    }

    pub fn search_first_player(&self, point: &Vec3<f32>, is_player: bool) -> Option<&Entity> {
        let Some(query_point) = point_array_if_finite(point) else {
            return None;
        };
        let skip = if is_player { 1 } else { 0 };
        let query_count = nearest_query_count(1, skip);
        let ent_id = self
            .players
            .first_nearest_item(&query_point, query_count, skip)?;
        self.entity_map.get(&ent_id)
    }

    pub fn search_entity(
        &self,
        point: &Vec3<f32>,
        count: usize,
        is_entity: bool,
    ) -> Vec<(f32, &Entity)> {
        if count == 0 {
            return Vec::new();
        }
        let Some(query_point) = point_array_if_finite(point) else {
            return Vec::new();
        };
        let skip = if is_entity { 1 } else { 0 };
        let tree_size = self.entities.tree.size() as usize;
        if tree_size <= skip {
            return Vec::new();
        }
        let max_results = count.min(tree_size - skip);
        let mut entities = Vec::with_capacity(max_results);
        let mut skipped = 0usize;
        self.entities
            .for_each_nearest(&query_point, nearest_query_count(count, skip), |dist, ent_id| {
                if skipped < skip {
                    skipped += 1;
                    return;
                }
                if let Some(entity) = self.entity_map.get(&ent_id) {
                    entities.push((dist, entity));
                }
            });
        entities
    }

    pub fn search_first_entity(&self, point: &Vec3<f32>, is_entity: bool) -> Option<&Entity> {
        let Some(query_point) = point_array_if_finite(point) else {
            return None;
        };
        let skip = if is_entity { 1 } else { 0 };
        let query_count = nearest_query_count(1, skip);
        let ent_id = self
            .entities
            .first_nearest_item(&query_point, query_count, skip)?;
        self.entity_map.get(&ent_id)
    }

    pub fn for_each_player_id_within_radius<F>(&self, point: &Vec3<f32>, radius: f32, f: F)
    where
        F: FnMut(u32),
    {
        if self.players.tree.size() == 0 {
            return;
        }
        let Some(query_point) = point_array_if_finite(point) else {
            return;
        };
        let Some(radius_squared) = normalized_radius_squared(radius) else {
            return;
        };
        self.players
            .for_each_within_id(&query_point, radius_squared, f);
    }

    pub fn player_ids_within_radius(&self, point: &Vec3<f32>, radius: f32) -> Vec<u32> {
        let player_tree_size = self.players.tree.size() as usize;
        if player_tree_size == 0 {
            return Vec::new();
        }
        let Some(query_point) = point_array_if_finite(point) else {
            return Vec::new();
        };
        let Some(radius_squared) = normalized_radius_squared(radius) else {
            return Vec::new();
        };
        let mut player_ids = Vec::with_capacity(player_tree_size.min(16));
        self.players
            .for_each_within_id(&query_point, radius_squared, |ent_id| player_ids.push(ent_id));
        player_ids
    }

    pub fn players_within_radius(&self, point: &Vec3<f32>, radius: f32) -> Vec<&Entity> {
        let player_tree_size = self.players.tree.size() as usize;
        if player_tree_size == 0 {
            return Vec::new();
        }
        let Some(query_point) = point_array_if_finite(point) else {
            return Vec::new();
        };
        let Some(radius_squared) = normalized_radius_squared(radius) else {
            return Vec::new();
        };
        let mut entities = Vec::with_capacity(player_tree_size.min(16));
        self.players.for_each_within_id(&query_point, radius_squared, |ent_id| {
            if let Some(entity) = self.entity_map.get(&ent_id) {
                entities.push(entity);
            }
        });
        entities
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_finite_point, nearest_query_count, normalized_radius_squared, point_array_if_finite,
        EntityTree,
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

    #[test]
    fn new_tree_starts_empty() {
        let tree = super::KdTree::new();
        assert_eq!(tree.len(), 0);
    }

    #[test]
    fn entity_tree_update_keeps_single_entry_for_same_id() {
        let mut tree = EntityTree::new();
        tree.add(7, [1.0, 2.0, 3.0]);
        tree.update(7, [1.0, 2.0, 3.0]);
        tree.update(7, [4.0, 5.0, 6.0]);

        assert_eq!(tree.positions.len(), 1);
        assert_eq!(tree.tree.size(), 1);
        assert_eq!(tree.positions.get(&7), Some(&[4.0, 5.0, 6.0]));
    }
}
