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
            interpolation: Interpolation::default(),
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
