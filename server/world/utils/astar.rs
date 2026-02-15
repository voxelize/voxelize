use serde::Serialize;
use hashbrown::HashSet;

use crate::Vec3;
use pathfinding::prelude::astar;

fn absdiff(a: i32, b: i32) -> u32 {
    (i64::from(a) - i64::from(b)).unsigned_abs() as u32
}

#[inline]
fn estimated_visited_capacity(start: &PathNode, goal: &PathNode) -> usize {
    let distance = start.distance(goal) as usize;
    distance.saturating_mul(4).clamp(128, 4096)
}

#[derive(Debug, Clone, Copy, Serialize, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct PathNode(pub i32, pub i32, pub i32);

impl PathNode {
    pub fn from_vec3(vec3: &Vec3<i32>) -> Self {
        Self(vec3.0, vec3.1, vec3.2)
    }

    pub fn distance(&self, other: &Self) -> u32 {
        absdiff(self.0, other.0)
            .saturating_add(absdiff(self.1, other.1))
            .saturating_add(absdiff(self.2, other.2))
    }
}

#[derive(Default)]
pub struct AStar;

impl AStar {
    pub fn calculate<FSuccessors, FHeuristic>(
        start: &Vec3<i32>,
        goal: &Vec3<i32>,
        successors: &FSuccessors,
        heuristic: &FHeuristic,
    ) -> Option<(Vec<PathNode>, u32)>
    where
        FSuccessors: Fn(&PathNode) -> Vec<(PathNode, u32)>,
        FHeuristic: Fn(&PathNode) -> u32,
    {
        let start_node = PathNode::from_vec3(start);
        let goal_node = PathNode::from_vec3(goal);

        let mut visited = HashSet::with_capacity(estimated_visited_capacity(&start_node, &goal_node));
        visited.insert(start_node);

        astar(
            &start_node,
            |p| {
                let mut next = successors(p);
                next.retain(|(s, _)| visited.insert(*s));
                next
            },
            heuristic,
            |p| *p == goal_node,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{estimated_visited_capacity, PathNode};

    #[test]
    fn distance_handles_i32_extreme_delta() {
        let a = PathNode(i32::MIN, 0, 0);
        let b = PathNode(i32::MAX, 0, 0);
        assert_eq!(a.distance(&b), u32::MAX);
    }

    #[test]
    fn distance_saturates_when_axis_deltas_overflow_sum() {
        let a = PathNode(i32::MIN, i32::MIN, 0);
        let b = PathNode(i32::MAX, i32::MAX, 0);
        assert_eq!(a.distance(&b), u32::MAX);
    }

    #[test]
    fn estimated_visited_capacity_is_clamped() {
        assert_eq!(
            estimated_visited_capacity(&PathNode(0, 0, 0), &PathNode(1, 0, 0)),
            128
        );
        assert_eq!(
            estimated_visited_capacity(&PathNode(0, 0, 0), &PathNode(3000, 0, 0)),
            4096
        );
    }
}
