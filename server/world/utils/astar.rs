use serde::Serialize;

use crate::Vec3;
use pathfinding::prelude::astar;

fn absdiff(a: i32, b: i32) -> u32 {
    if a > b {
        (a - b) as u32
    } else {
        (b - a) as u32
    }
}

#[derive(Debug, Clone, Serialize, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct PathNode(pub i32, pub i32, pub i32);

impl PathNode {
    pub fn from_vec3(vec3: &Vec3<i32>) -> Self {
        Self(vec3.0, vec3.1, vec3.2)
    }

    pub fn distance(&self, other: &Self) -> u32 {
        (absdiff(self.0, other.0) + absdiff(self.1, other.1) + absdiff(self.2, other.2)) as u32
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
        visited.insert(start_node.clone());

        astar(
            &start_node,
            |p| {
                successors(p)
                    .into_iter()
                    .filter(|(s, _)| visited.insert(s.clone()))
                    .collect::<Vec<_>>()
            },
            heuristic,
            |p| *p == goal_node,
        )
    }
}
