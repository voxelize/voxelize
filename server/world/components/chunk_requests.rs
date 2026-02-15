use specs::{Component, VecStorage};

use crate::Vec2;

/// A list of chunks that the entity is requesting to generate.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequestsComp {
    pub center: Vec2<i32>,
    // a 2d unit vector
    pub direction: Vec2<f32>,
    pub requests: Vec<Vec2<i32>>,
}

#[inline]
fn manhattan_distance(a: &Vec2<i32>, b: &Vec2<i32>) -> u64 {
    (i64::from(a.0) - i64::from(b.0))
        .unsigned_abs()
        .saturating_add((i64::from(a.1) - i64::from(b.1)).unsigned_abs())
}

impl ChunkRequestsComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the center of the list of chunk requests.
    pub fn set_center(&mut self, center: &Vec2<i32>) {
        self.center = *center;
    }

    /// Set the direction of the list of chunk requests.
    pub fn set_direction(&mut self, direction: &Vec2<f32>) {
        self.direction = *direction;
    }

    /// Add a chunk to the list of chunks requested.
    pub fn add(&mut self, coords: &Vec2<i32>) {
        if self.requests.is_empty() {
            self.requests.push(*coords);
            return;
        }
        if self.requests.last().is_some_and(|last| last == coords) || self.requests.contains(coords)
        {
            return;
        }

        self.requests.push(*coords);
    }

    pub fn sort(&mut self) {
        if self.requests.len() <= 1 {
            return;
        }
        self.requests
            .sort_by_cached_key(|coords| manhattan_distance(coords, &self.center));
    }

    /// Remove a chunk from the list of chunks requested.
    pub fn remove(&mut self, coords: &Vec2<i32>) {
        if self.requests.is_empty() {
            return;
        }
        if self.requests.last().is_some_and(|last| last == coords) {
            self.requests.pop();
            return;
        }
        self.requests.retain(|c| c != coords);
    }
}

#[cfg(test)]
mod tests {
    use super::{manhattan_distance, ChunkRequestsComp};
    use crate::Vec2;

    #[test]
    fn manhattan_distance_handles_i32_extremes() {
        let dist = manhattan_distance(&Vec2(i32::MIN, i32::MIN), &Vec2(i32::MAX, i32::MAX));
        assert_eq!(dist, 8_589_934_590);
    }

    #[test]
    fn sort_orders_requests_with_extreme_coordinates() {
        let mut requests = ChunkRequestsComp::new();
        requests.center = Vec2(i32::MAX, i32::MAX);
        requests.requests = vec![
            Vec2(i32::MIN, i32::MIN),
            Vec2(i32::MAX - 1, i32::MAX),
            Vec2(i32::MAX, i32::MAX - 1),
        ];

        requests.sort();

        assert_eq!(requests.requests[0], Vec2(i32::MAX - 1, i32::MAX));
        assert_eq!(requests.requests[1], Vec2(i32::MAX, i32::MAX - 1));
        assert_eq!(requests.requests[2], Vec2(i32::MIN, i32::MIN));
    }
}
