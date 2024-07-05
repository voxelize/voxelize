use crate::Vec3;
use specs::Entity;
use std::cmp::Ordering;

#[derive(Debug, Clone)]
struct KdNode {
    point: Vec3<f32>,
    entity: Entity,
    is_player: bool,
    left: Option<Box<KdNode>>,
    right: Option<Box<KdNode>>,
}

#[derive(Debug)]
pub struct KdTree {
    root: Option<Box<KdNode>>,
    dimension: usize,
}

impl KdTree {
    pub fn new() -> Self {
        Self {
            root: None,
            dimension: 3,
        }
    }

    pub fn add(&mut self, point: Vec3<f32>, entity: Entity) {
        let new_node = Box::new(KdNode {
            point,
            entity,
            is_player: false,
            left: None,
            right: None,
        });
        let root = self.root.take();
        self.root = Some(self.insert(root, new_node, 0));
    }

    fn insert(
        &mut self,
        node: Option<Box<KdNode>>,
        new_node: Box<KdNode>,
        depth: usize,
    ) -> Box<KdNode> {
        if let Some(mut node) = node {
            let axis = depth % self.dimension;
            if new_node.point[axis] < node.point[axis] {
                node.left = Some(self.insert(node.left.take(), new_node, depth + 1));
            } else {
                node.right = Some(self.insert(node.right.take(), new_node, depth + 1));
            }
            node
        } else {
            new_node
        }
    }

    pub fn nearest(&self, target: &Vec3<f32>, k: usize) -> Vec<(f32, Entity)> {
        let mut nearest = Vec::with_capacity(k);
        if let Some(root) = &self.root {
            self.nearest_recursive(root, target, k, 0, &mut nearest);
        }
        nearest.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
        nearest
    }

    fn nearest_recursive(
        &self,
        node: &KdNode,
        target: &Vec3<f32>,
        k: usize,
        depth: usize,
        nearest: &mut Vec<(f32, Entity)>,
    ) {
        let dist = squared_distance(&node.point, target);

        if nearest.len() < k {
            nearest.push((dist, node.entity));
            nearest.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
        } else if dist < nearest[0].0 {
            nearest[0] = (dist, node.entity);
            nearest.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
        }

        let axis = depth % self.dimension;
        let diff = target[axis] - node.point[axis];

        let (closer, further) = if diff <= 0.0 {
            (&node.left, &node.right)
        } else {
            (&node.right, &node.left)
        };

        if let Some(closer) = closer {
            self.nearest_recursive(closer, target, k, depth + 1, nearest);
        }

        if let Some(further) = further {
            if nearest.is_empty() || diff * diff < nearest[0].0 || nearest.len() < k {
                self.nearest_recursive(further, target, k, depth + 1, nearest);
            }
        }
    }

    pub fn nearest_n(&self, target: &Vec3<f32>, n: usize) -> Vec<(f32, Entity)> {
        self.nearest(target, n)
    }

    pub fn nearest_one(&self, target: &Vec3<f32>) -> Option<(f32, Entity)> {
        self.nearest(target, 1).into_iter().next()
    }

    pub fn clear(&mut self) {
        self.root = None;
    }

    pub fn reset(&mut self) {
        self.clear();
    }

    pub fn add_entity(&mut self, entity: Entity, position: Vec3<f32>) {
        self.add_internal(position, entity, false);
    }

    pub fn add_player(&mut self, entity: Entity, position: Vec3<f32>) {
        self.add_internal(position, entity, true);
    }

    fn add_internal(&mut self, point: Vec3<f32>, entity: Entity, is_player: bool) {
        let new_node = Box::new(KdNode {
            point,
            entity,
            is_player,
            left: None,
            right: None,
        });
        let root = self.root.take();
        self.root = Some(self.insert(root, new_node, 0));
    }

    pub fn search(&self, target: &Vec3<f32>, k: usize) -> Vec<(f32, Entity)> {
        self.nearest(target, k)
    }

    pub fn search_player(
        &self,
        target: &Vec3<f32>,
        k: usize,
        exclude_self: bool,
    ) -> Vec<(f32, Entity)> {
        let mut nearest = Vec::with_capacity(k);
        if let Some(root) = &self.root {
            self.search_recursive(root, target, k, 0, &mut nearest, true, exclude_self);
        }
        nearest.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
        nearest
    }

    pub fn search_entity(
        &self,
        target: &Vec3<f32>,
        k: usize,
        exclude_self: bool,
    ) -> Vec<(f32, Entity)> {
        let mut nearest = Vec::with_capacity(k);
        if let Some(root) = &self.root {
            self.search_recursive(root, target, k, 0, &mut nearest, false, exclude_self);
        }
        nearest.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
        nearest
    }

    fn search_recursive(
        &self,
        node: &KdNode,
        target: &Vec3<f32>,
        k: usize,
        depth: usize,
        nearest: &mut Vec<(f32, Entity)>,
        players_only: bool,
        exclude_self: bool,
    ) {
        let dist = squared_distance(&node.point, target);

        if (!players_only || node.is_player) && (!exclude_self || dist > 0.0) {
            if nearest.len() < k {
                nearest.push((dist, node.entity));
                nearest.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
            } else if dist < nearest[0].0 {
                nearest[0] = (dist, node.entity);
                nearest.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
            }
        }

        let axis = depth % self.dimension;
        let diff = target[axis] - node.point[axis];

        let (closer, further) = if diff <= 0.0 {
            (&node.left, &node.right)
        } else {
            (&node.right, &node.left)
        };

        if let Some(closer) = closer {
            self.search_recursive(
                closer,
                target,
                k,
                depth + 1,
                nearest,
                players_only,
                exclude_self,
            );
        }

        if let Some(further) = further {
            if nearest.is_empty() || diff * diff < nearest[0].0 || nearest.len() < k {
                self.search_recursive(
                    further,
                    target,
                    k,
                    depth + 1,
                    nearest,
                    players_only,
                    exclude_self,
                );
            }
        }
    }
}

fn squared_distance(a: &Vec3<f32>, b: &Vec3<f32>) -> f32 {
    (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2) + (a.2 - b.2).powi(2)
}

impl Default for KdTree {
    fn default() -> Self {
        Self::new()
    }
}
