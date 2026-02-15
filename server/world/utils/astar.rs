use serde::Serialize;

use crate::Vec3;
use pathfinding::prelude::astar;

fn absdiff(a: i32, b: i32) -> u32 {
    (i64::from(a) - i64::from(b)).unsigned_abs() as u32
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
    pub fn calculate(
        start: &Vec3<i32>,
        goal: &Vec3<i32>,
        successors: &dyn Fn(&PathNode) -> Vec<(PathNode, u32)>,
        heuristic: &dyn Fn(&PathNode) -> u32,
    ) -> Option<(Vec<PathNode>, u32)> {
        let start_node = PathNode::from_vec3(start);
        let goal_node = PathNode::from_vec3(goal);

        let mut visited = std::collections::HashSet::new();
        visited.insert(start_node);

        astar(
            &start_node,
            |p| {
                successors(p)
                    .into_iter()
                    .filter(|(s, _)| visited.insert(*s))
                    .collect::<Vec<_>>()
            },
            heuristic,
            |p| *p == goal_node,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::PathNode;

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
}
