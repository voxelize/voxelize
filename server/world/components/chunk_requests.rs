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
    u64::from(a.0.abs_diff(b.0)).saturating_add(u64::from(a.1.abs_diff(b.1)))
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
            6 => {
                let first = self.requests[0];
                let second = self.requests[1];
                let third = self.requests[2];
                let fourth = self.requests[3];
                let fifth = self.requests[4];
                let sixth = self.requests[5];
                if *coords != first
                    && *coords != second
                    && *coords != third
                    && *coords != fourth
                    && *coords != fifth
                    && *coords != sixth
                {
                    self.requests.push(*coords);
                }
                return;
            }
            7 => {
                let first = self.requests[0];
                let second = self.requests[1];
                let third = self.requests[2];
                let fourth = self.requests[3];
                let fifth = self.requests[4];
                let sixth = self.requests[5];
                let seventh = self.requests[6];
                if *coords != first
                    && *coords != second
                    && *coords != third
                    && *coords != fourth
                    && *coords != fifth
                    && *coords != sixth
                    && *coords != seventh
                {
                    self.requests.push(*coords);
                }
                return;
            }
            8 => {
                let first = self.requests[0];
                let second = self.requests[1];
                let third = self.requests[2];
                let fourth = self.requests[3];
                let fifth = self.requests[4];
                let sixth = self.requests[5];
                let seventh = self.requests[6];
                let eighth = self.requests[7];
                if *coords != first
                    && *coords != second
                    && *coords != third
                    && *coords != fourth
                    && *coords != fifth
                    && *coords != sixth
                    && *coords != seventh
                    && *coords != eighth
                {
                    self.requests.push(*coords);
                }
                return;
            }
            9 => {
                let first = self.requests[0];
                let second = self.requests[1];
                let third = self.requests[2];
                let fourth = self.requests[3];
                let fifth = self.requests[4];
                let sixth = self.requests[5];
                let seventh = self.requests[6];
                let eighth = self.requests[7];
                let ninth = self.requests[8];
                if *coords != first
                    && *coords != second
                    && *coords != third
                    && *coords != fourth
                    && *coords != fifth
                    && *coords != sixth
                    && *coords != seventh
                    && *coords != eighth
                    && *coords != ninth
                {
                    self.requests.push(*coords);
                }
                return;
            }
            _ => {}
        }
        let last_request_index = self.requests.len() - 1;
        if self.requests[last_request_index] == *coords || self.requests[0] == *coords {
            return;
        }
        for request_index in 1..last_request_index {
            if self.requests[request_index] == *coords {
                return;
            }
        }
        self.requests.push(*coords);
    }

    pub fn sort(&mut self) {
        match self.requests.len() {
            0 | 1 => return,
            2 => {
                let first_distance = manhattan_distance(&self.requests[0], &self.center);
                let second_distance = manhattan_distance(&self.requests[1], &self.center);
                if first_distance > second_distance {
                    self.requests.swap(0, 1);
                }
                return;
            }
            3 => {
                let mut first_distance =
                    manhattan_distance(&self.requests[0], &self.center);
                let mut second_distance =
                    manhattan_distance(&self.requests[1], &self.center);
                let third_distance = manhattan_distance(&self.requests[2], &self.center);
                if first_distance > second_distance {
                    self.requests.swap(0, 1);
                    std::mem::swap(&mut first_distance, &mut second_distance);
                }
                if second_distance > third_distance {
                    self.requests.swap(1, 2);
                    second_distance = third_distance;
                }
                if first_distance > second_distance {
                    self.requests.swap(0, 1);
                }
                return;
            }
            4 => {
                let mut first_distance =
                    manhattan_distance(&self.requests[0], &self.center);
                let mut second_distance =
                    manhattan_distance(&self.requests[1], &self.center);
                let mut third_distance =
                    manhattan_distance(&self.requests[2], &self.center);
                let mut fourth_distance =
                    manhattan_distance(&self.requests[3], &self.center);

                if first_distance > second_distance {
                    self.requests.swap(0, 1);
                    std::mem::swap(&mut first_distance, &mut second_distance);
                }
                if third_distance > fourth_distance {
                    self.requests.swap(2, 3);
                    std::mem::swap(&mut third_distance, &mut fourth_distance);
                }
                if first_distance > third_distance {
                    self.requests.swap(0, 2);
                    std::mem::swap(&mut first_distance, &mut third_distance);
                }
                if second_distance > fourth_distance {
                    self.requests.swap(1, 3);
                    std::mem::swap(&mut second_distance, &mut fourth_distance);
                }
                if second_distance > third_distance {
                    self.requests.swap(1, 2);
                }
                return;
            }
            5 => {
                let mut first_distance =
                    manhattan_distance(&self.requests[0], &self.center);
                let mut second_distance =
                    manhattan_distance(&self.requests[1], &self.center);
                let mut third_distance =
                    manhattan_distance(&self.requests[2], &self.center);
                let mut fourth_distance =
                    manhattan_distance(&self.requests[3], &self.center);
                let mut fifth_distance =
                    manhattan_distance(&self.requests[4], &self.center);

                if first_distance > second_distance {
                    self.requests.swap(0, 1);
                    std::mem::swap(&mut first_distance, &mut second_distance);
                }
                if fourth_distance > fifth_distance {
                    self.requests.swap(3, 4);
                    std::mem::swap(&mut fourth_distance, &mut fifth_distance);
                }
                if third_distance > fifth_distance {
                    self.requests.swap(2, 4);
                    std::mem::swap(&mut third_distance, &mut fifth_distance);
                }
                if third_distance > fourth_distance {
                    self.requests.swap(2, 3);
                    std::mem::swap(&mut third_distance, &mut fourth_distance);
                }
                if second_distance > fifth_distance {
                    self.requests.swap(1, 4);
                    std::mem::swap(&mut second_distance, &mut fifth_distance);
                }
                if first_distance > fourth_distance {
                    self.requests.swap(0, 3);
                    std::mem::swap(&mut first_distance, &mut fourth_distance);
                }
                if first_distance > third_distance {
                    self.requests.swap(0, 2);
                    std::mem::swap(&mut first_distance, &mut third_distance);
                }
                if second_distance > fourth_distance {
                    self.requests.swap(1, 3);
                    std::mem::swap(&mut second_distance, &mut fourth_distance);
                }
                if second_distance > third_distance {
                    self.requests.swap(1, 2);
                }
                return;
            }
            _ => {}
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
        match self.requests.len() {
            3 => {
                if self.requests[1] == *coords {
                    self.requests.remove(1);
                }
                return;
            }
            4 => {
                if self.requests[1] == *coords {
                    self.requests.remove(1);
                    return;
                }
                if self.requests[2] == *coords {
                    self.requests.remove(2);
                }
                return;
            }
            5 => {
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
            6 => {
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
                    return;
                }
                if self.requests[4] == *coords {
                    self.requests.remove(4);
                }
                return;
            }
            7 => {
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
                    return;
                }
                if self.requests[4] == *coords {
                    self.requests.remove(4);
                    return;
                }
                if self.requests[5] == *coords {
                    self.requests.remove(5);
                }
                return;
            }
            8 => {
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
                    return;
                }
                if self.requests[4] == *coords {
                    self.requests.remove(4);
                    return;
                }
                if self.requests[5] == *coords {
                    self.requests.remove(5);
                    return;
                }
                if self.requests[6] == *coords {
                    self.requests.remove(6);
                }
                return;
            }
            9 => {
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
                    return;
                }
                if self.requests[4] == *coords {
                    self.requests.remove(4);
                    return;
                }
                if self.requests[5] == *coords {
                    self.requests.remove(5);
                    return;
                }
                if self.requests[6] == *coords {
                    self.requests.remove(6);
                    return;
                }
                if self.requests[7] == *coords {
                    self.requests.remove(7);
                }
                return;
            }
            _ => {
                let last_request_index = self.requests.len() - 1;
                for request_index in 1..last_request_index {
                    if self.requests[request_index] == *coords {
                        self.requests.remove(request_index);
                        return;
                    }
                }
            }
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
    fn sort_orders_two_requests_without_generic_sort() {
        let mut requests = ChunkRequestsComp::new();
        requests.center = Vec2(0, 0);
        requests.requests = vec![Vec2(5, 0), Vec2(1, 0)];

        requests.sort();

        assert_eq!(requests.requests, vec![Vec2(1, 0), Vec2(5, 0)]);
    }

    #[test]
    fn sort_orders_three_requests_without_generic_sort() {
        let mut requests = ChunkRequestsComp::new();
        requests.center = Vec2(0, 0);
        requests.requests = vec![Vec2(3, 0), Vec2(2, 0), Vec2(1, 0)];

        requests.sort();

        assert_eq!(
            requests.requests,
            vec![Vec2(1, 0), Vec2(2, 0), Vec2(3, 0)]
        );
    }

    #[test]
    fn sort_orders_four_requests_without_generic_sort() {
        let mut requests = ChunkRequestsComp::new();
        requests.center = Vec2(0, 0);
        requests.requests = vec![Vec2(4, 0), Vec2(2, 0), Vec2(1, 0), Vec2(3, 0)];

        requests.sort();

        assert_eq!(
            requests.requests,
            vec![Vec2(1, 0), Vec2(2, 0), Vec2(3, 0), Vec2(4, 0)]
        );
    }

    #[test]
    fn sort_orders_five_requests_without_generic_sort() {
        let mut requests = ChunkRequestsComp::new();
        requests.center = Vec2(0, 0);
        requests.requests = vec![
            Vec2(5, 0),
            Vec2(2, 0),
            Vec2(1, 0),
            Vec2(4, 0),
            Vec2(3, 0),
        ];

        requests.sort();

        assert_eq!(
            requests.requests,
            vec![Vec2(1, 0), Vec2(2, 0), Vec2(3, 0), Vec2(4, 0), Vec2(5, 0)]
        );
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
    fn add_ignores_duplicate_middle_entries_for_large_lists() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![
            Vec2(1, 1),
            Vec2(2, 2),
            Vec2(3, 3),
            Vec2(4, 4),
            Vec2(5, 5),
            Vec2(6, 6),
        ];

        requests.add(&Vec2(4, 4));

        assert_eq!(
            requests.requests,
            vec![
                Vec2(1, 1),
                Vec2(2, 2),
                Vec2(3, 3),
                Vec2(4, 4),
                Vec2(5, 5),
                Vec2(6, 6)
            ]
        );
    }

    #[test]
    fn add_ignores_duplicate_entries_for_eight_item_lists() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![
            Vec2(1, 1),
            Vec2(2, 2),
            Vec2(3, 3),
            Vec2(4, 4),
            Vec2(5, 5),
            Vec2(6, 6),
            Vec2(7, 7),
            Vec2(8, 8),
        ];

        requests.add(&Vec2(4, 4));
        requests.add(&Vec2(7, 7));

        assert_eq!(
            requests.requests,
            vec![
                Vec2(1, 1),
                Vec2(2, 2),
                Vec2(3, 3),
                Vec2(4, 4),
                Vec2(5, 5),
                Vec2(6, 6),
                Vec2(7, 7),
                Vec2(8, 8)
            ]
        );
    }

    #[test]
    fn add_ignores_duplicate_entries_for_nine_item_lists() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![
            Vec2(1, 1),
            Vec2(2, 2),
            Vec2(3, 3),
            Vec2(4, 4),
            Vec2(5, 5),
            Vec2(6, 6),
            Vec2(7, 7),
            Vec2(8, 8),
            Vec2(9, 9),
        ];

        requests.add(&Vec2(5, 5));
        requests.add(&Vec2(9, 9));

        assert_eq!(
            requests.requests,
            vec![
                Vec2(1, 1),
                Vec2(2, 2),
                Vec2(3, 3),
                Vec2(4, 4),
                Vec2(5, 5),
                Vec2(6, 6),
                Vec2(7, 7),
                Vec2(8, 8),
                Vec2(9, 9),
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

    #[test]
    fn remove_handles_large_list_middle_entries() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![
            Vec2(1, 1),
            Vec2(2, 2),
            Vec2(3, 3),
            Vec2(4, 4),
            Vec2(5, 5),
            Vec2(6, 6),
        ];

        requests.remove(&Vec2(4, 4));

        assert_eq!(
            requests.requests,
            vec![Vec2(1, 1), Vec2(2, 2), Vec2(3, 3), Vec2(5, 5), Vec2(6, 6)]
        );
    }

    #[test]
    fn remove_handles_eight_item_middle_entries() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![
            Vec2(1, 1),
            Vec2(2, 2),
            Vec2(3, 3),
            Vec2(4, 4),
            Vec2(5, 5),
            Vec2(6, 6),
            Vec2(7, 7),
            Vec2(8, 8),
        ];

        requests.remove(&Vec2(5, 5));
        requests.remove(&Vec2(7, 7));

        assert_eq!(
            requests.requests,
            vec![
                Vec2(1, 1),
                Vec2(2, 2),
                Vec2(3, 3),
                Vec2(4, 4),
                Vec2(6, 6),
                Vec2(8, 8)
            ]
        );
    }

    #[test]
    fn remove_handles_nine_item_middle_entries() {
        let mut requests = ChunkRequestsComp::new();
        requests.requests = vec![
            Vec2(1, 1),
            Vec2(2, 2),
            Vec2(3, 3),
            Vec2(4, 4),
            Vec2(5, 5),
            Vec2(6, 6),
            Vec2(7, 7),
            Vec2(8, 8),
            Vec2(9, 9),
        ];

        requests.remove(&Vec2(6, 6));
        requests.remove(&Vec2(8, 8));

        assert_eq!(
            requests.requests,
            vec![
                Vec2(1, 1),
                Vec2(2, 2),
                Vec2(3, 3),
                Vec2(4, 4),
                Vec2(5, 5),
                Vec2(7, 7),
                Vec2(9, 9),
            ]
        );
    }
}
