use serde::Serialize;
use splines::{Interpolation, Key, Spline};
use std::f64;

/// Spline graph of Voxelize. Used to map noise values to custom values.
#[derive(Clone, Serialize, Debug)]
pub struct SplineMap {
    min: f64,
    min_val: f64,
    max: f64,
    max_val: f64,
    left_val: f64,
    right_val: f64,
    spline: Spline<f64, f64>,
}

impl Default for SplineMap {
    fn default() -> Self {
        let spline = Spline::from_vec(vec![]);
        Self {
            spline,
            min: f64::MAX,
            max: f64::MIN,
            min_val: f64::MAX,
            max_val: f64::MIN,
            left_val: 0.0,
            right_val: 0.0,
        }
    }
}

impl SplineMap {
    /// Add a point to the spline graph.
    pub fn add(&mut self, t: f64, value: f64) -> &mut Self {
        if t < self.min {
            self.min = t;
            self.left_val = value;
        }

        if value < self.min_val {
            self.min_val = value;
        }

        if t > self.max {
            self.max = t;
            self.right_val = value;
        }

        if value > self.max_val {
            self.max_val = value;
        }

        let point = Key::new(t, value, Interpolation::Linear);
        self.spline.add(point);

        self
    }

    /// Rescale the y-axis of the spline graph.
    pub fn rescale_values(&mut self, min_val: f64, max_val: f64) -> &mut Self {
        let scale = |num: f64| {
            if self.min_val == self.max_val {
                return self.min_val;
            }
            (max_val - min_val) * (num - self.min_val) / (self.max_val - self.min_val) + min_val
        };

        self.left_val = scale(self.left_val);
        self.right_val = scale(self.right_val);

        let keys = self.spline.keys().to_owned();

        let mut index = 0;
        keys.into_iter().for_each(|_| {
            self.spline.replace(index, |key| {
                let mut key = key.to_owned();
                key.value = scale(key.value);
                key
            });
            index += 1;
        });

        self.min_val = min_val;
        self.max_val = max_val;

        self
    }

    /// Rescale the x-axis of the spline graph.
    pub fn rescale_t(&mut self, min: f64, max: f64) -> &mut Self {
        let scale = |num: f64| {
            if self.min == self.max {
                return self.min;
            }

            (max - min) * (num - self.min) / (self.max - self.min) + min
        };

        let keys = self.spline.keys().to_owned();

        let mut index = 0;
        keys.into_iter().for_each(|_| {
            self.spline.replace(index, |key| {
                let mut key = key.to_owned();
                key.t = scale(key.t);
                key
            });
            index += 1;
        });

        self.min = min;
        self.max = max;

        self
    }

    /// Sample the spline graph at an x-coordinate.
    pub fn sample(&self, t: f64) -> f64 {
        assert!(
            !self.spline.is_empty(),
            "Spline graph is empty, nothing to sample from!"
        );

        if let Some(value) = self.spline.sample(t) {
            return value;
        }

        if t < self.min {
            return self.left_val;
        }

        self.right_val
    }
}
