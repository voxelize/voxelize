use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::hash::Hash;
use std::sync::{Arc, Mutex};

pub struct AStar;

#[derive(Clone, Eq, PartialEq, Hash)]
pub struct AStarNode(pub i32, pub i32, pub i32);

impl AStarNode {
    pub fn distance(&self, other: &AStarNode) -> f32 {
        (((self.0 - other.0).pow(2) + (self.1 - other.1).pow(2) + (self.2 - other.2).pow(2)) as f32)
            .sqrt()
    }
}

#[derive(Clone, PartialEq)]
struct State {
    cost: f32,
    node: AStarNode,
}

impl Eq for State {}

impl Ord for State {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .partial_cmp(&self.cost)
            .unwrap_or(Ordering::Equal)
    }
}

impl PartialOrd for State {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl AStar {
    pub fn calculate(
        start: &AStarNode,
        goal: &AStarNode,
        successors: &dyn Fn(&AStarNode) -> Vec<(AStarNode, u32)>,
        heuristic: &dyn Fn(&AStarNode) -> f32,
    ) -> Option<(Vec<AStarNode>, u32)> {
        let mut open_set = BinaryHeap::new();
        let mut came_from = HashMap::new();
        let mut g_score = HashMap::new();
        let mut f_score = HashMap::new();

        g_score.insert(start.clone(), 0);
        f_score.insert(start.clone(), heuristic(start));
        open_set.push(State {
            cost: f_score[start],
            node: start.clone(),
        });

        let count = Arc::new(Mutex::new(0));

        while let Some(State { node, .. }) = open_set.pop() {
            if node == *goal {
                let path = Self::reconstruct_path(&came_from, &node);
                return Some((path, *g_score.get(&node).unwrap()));
            }

            for (neighbor, cost) in successors(&node) {
                let mut locked_count = count.lock().unwrap();
                *locked_count += 1;
                if *locked_count >= 512 {
                    // MAX_DEPTH_SEARCH
                    return None;
                }
                drop(locked_count);

                let tentative_g_score = g_score[&node] + cost;

                if tentative_g_score < *g_score.get(&neighbor).unwrap_or(&u32::MAX) {
                    came_from.insert(neighbor.clone(), node.clone());
                    g_score.insert(neighbor.clone(), tentative_g_score);
                    let f = tentative_g_score as f32 + heuristic(&neighbor);
                    f_score.insert(neighbor.clone(), f);
                    open_set.push(State {
                        cost: f,
                        node: neighbor,
                    });
                }
            }
        }

        None
    }

    fn reconstruct_path(
        came_from: &HashMap<AStarNode, AStarNode>,
        current: &AStarNode,
    ) -> Vec<AStarNode> {
        let mut path = vec![current.clone()];
        let mut current = current;
        while let Some(prev) = came_from.get(current) {
            path.push(prev.clone());
            current = prev;
        }
        path.reverse();
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_astar_pathfinding() {
        let start = AStarNode(0, 0, 0);
        let goal = AStarNode(2, 2, 2);

        let successors = |node: &AStarNode| {
            let mut successors = Vec::new();
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for dz in -1..=1 {
                        if dx == 0 && dy == 0 && dz == 0 {
                            continue;
                        }
                        let new_node = AStarNode(node.0 + dx, node.1 + dy, node.2 + dz);
                        successors.push((new_node, 1));
                    }
                }
            }
            successors
        };

        let heuristic = |p: &AStarNode| p.distance(&goal) / 3.0;

        let path = AStar::calculate(&start, &goal, &successors, &heuristic);

        assert!(path.is_some());
        let (path, cost) = path.unwrap();
        assert!(!path.is_empty());
        assert!(cost > 0);
    }
}
