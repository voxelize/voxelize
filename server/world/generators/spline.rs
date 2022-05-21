use log::info;
use splines::{Interpolation, Key, Spline};

#[derive(Clone)]
pub struct SplineMap {
    min: f64,
    min_val: f64,
    max: f64,
    max_val: f64,
    spline: Spline<f64, f64>,
    interpolation: Interpolation<f64, f64>,
}

impl SplineMap {
    pub fn new() -> Self {
        let spline = Spline::from_vec(vec![]);
        Self {
            spline,
            min: 0.0,
            max: 0.0,
            min_val: 0.0,
            max_val: 0.0,
            interpolation: Interpolation::Cosine,
        }
    }

    pub fn add(&mut self, point: [f64; 2]) -> &mut Self {
        if point[0] < self.min {
            self.min = point[0];
            self.min_val = point[1];
        }

        if point[0] > self.max {
            self.max = point[0];
            self.max_val = point[1];
        }

        let point = Key::new(point[0], point[1], self.interpolation.to_owned());
        self.spline.add(point);

        self
    }

    pub fn rescale_values(&mut self, min_val: f64, max_val: f64) -> &mut Self {
        let scale = |num: f64| {
            (max_val - min_val) * (num - self.min_val) / (self.max_val - self.min_val) + min_val
        };

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

    pub fn rescale_t(&mut self, min: f64, max: f64) -> &mut Self {
        let scale = |num: f64| (max - min) * (num - self.min) / (self.max - self.min) + min;

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

    pub fn sample(&self, x: f64) -> f64 {
        if let Some(value) = self.spline.sample(x) {
            return value;
        }

        if x < self.min {
            return self.min_val;
        }

        self.max_val
    }
}
