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
        match self.requests.len() {
            0 => {
                self.requests.push(*coords);
                return;
            }
            1 => {
                if self.requests[0] != *coords {
                    self.requests.push(*coords);
                }
                return;
            }
            2 => {
                let first = self.requests[0];
                let second = self.requests[1];
                if *coords != first && *coords != second {
                    self.requests.push(*coords);
                }
                return;
            }
            3 => {
                let first = self.requests[0];
                let second = self.requests[1];
                let third = self.requests[2];
                if *coords != first && *coords != second && *coords != third {
                    self.requests.push(*coords);
                }
                return;
            }
            4 => {
                let first = self.requests[0];
                let second = self.requests[1];
                let third = self.requests[2];
                let fourth = self.requests[3];
                if *coords != first
                    && *coords != second
                    && *coords != third
                    && *coords != fourth
                {
                    self.requests.push(*coords);
                }
                return;
            }
            5 => {
                let first = self.requests[0];
                let second = self.requests[1];
                let third = self.requests[2];
                let fourth = self.requests[3];
                let fifth = self.requests[4];
                if *coords != first
                    && *coords != second
                    && *coords != third
                    && *coords != fourth
                    && *coords != fifth
                {
                    self.requests.push(*coords);
                }
                return;
            }
            _ => {}
        }
        if self.requests.last().is_some_and(|last| last == coords)
            || self.requests.first().is_some_and(|first| first == coords)
            || self.requests.contains(coords)
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
            .sort_unstable_by_key(|coords| manhattan_distance(coords, &self.center));
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
        if self.requests.first().is_some_and(|first| first == coords) {
            self.requests.remove(0);
            return;
        }
        if self.requests.len() == 3 {
            if self.requests[1] == *coords {
                self.requests.remove(1);
            }
            return;
        }
        if self.requests.len() == 4 {
            if self.requests[1] == *coords {
                self.requests.remove(1);
                return;
            }
            if self.requests[2] == *coords {
                self.requests.remove(2);
            }
            return;
        }
        if self.requests.len() == 5 {
            if self.requests[1] == *coords {
                self.requests.remove(1);
                return;
            }
            if self.requests[2] == *coords {
                self.requests.remove(2);
                return;
            }
            if self.requests[3] == *coords {
                self.requests.remove(3);
            }
            return;
        }
        if let Some(index) = self.requests.iter().position(|c| c == coords) {
            self.requests.remove(index);
        }
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

    #[test]
    fn add_ignores_duplicate_first_and_tail_entries() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![Vec2(1, 1), Vec2(2, 2)];

        requests.add(&Vec2(1, 1));
        requests.add(&Vec2(2, 2));

        assert_eq!(requests.requests, vec![Vec2(1, 1), Vec2(2, 2)]);
    }

    #[test]
    fn add_ignores_duplicate_middle_entries_for_small_lists() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![Vec2(1, 1), Vec2(2, 2), Vec2(3, 3), Vec2(4, 4)];

        requests.add(&Vec2(2, 2));
        requests.add(&Vec2(3, 3));

        assert_eq!(
            requests.requests,
            vec![Vec2(1, 1), Vec2(2, 2), Vec2(3, 3), Vec2(4, 4)]
        );
    }

    #[test]
    fn add_ignores_duplicate_entries_for_five_item_lists() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![
            Vec2(1, 1),
            Vec2(2, 2),
            Vec2(3, 3),
            Vec2(4, 4),
            Vec2(5, 5),
        ];

        requests.add(&Vec2(3, 3));
        requests.add(&Vec2(5, 5));

        assert_eq!(
            requests.requests,
            vec![
                Vec2(1, 1),
                Vec2(2, 2),
                Vec2(3, 3),
                Vec2(4, 4),
                Vec2(5, 5)
            ]
        );
    }

    #[test]
    fn remove_handles_first_and_tail_entries() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![Vec2(1, 1), Vec2(2, 2), Vec2(3, 3)];

        requests.remove(&Vec2(1, 1));
        assert_eq!(requests.requests, vec![Vec2(2, 2), Vec2(3, 3)]);

        requests.remove(&Vec2(3, 3));
        assert_eq!(requests.requests, vec![Vec2(2, 2)]);
    }

    #[test]
    fn remove_handles_small_list_middle_entries() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![Vec2(1, 1), Vec2(2, 2), Vec2(3, 3), Vec2(4, 4)];

        requests.remove(&Vec2(2, 2));
        assert_eq!(requests.requests, vec![Vec2(1, 1), Vec2(3, 3), Vec2(4, 4)]);

        requests.remove(&Vec2(3, 3));
        assert_eq!(requests.requests, vec![Vec2(1, 1), Vec2(4, 4)]);
    }

    #[test]
    fn remove_handles_five_item_middle_entries() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![
            Vec2(1, 1),
            Vec2(2, 2),
            Vec2(3, 3),
            Vec2(4, 4),
            Vec2(5, 5),
        ];

        requests.remove(&Vec2(3, 3));
        assert_eq!(
            requests.requests,
            vec![Vec2(1, 1), Vec2(2, 2), Vec2(4, 4), Vec2(5, 5)]
        );

        requests.remove(&Vec2(4, 4));
        assert_eq!(requests.requests, vec![Vec2(1, 1), Vec2(2, 2), Vec2(5, 5)]);
    }
}
