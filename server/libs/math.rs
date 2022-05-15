#![allow(dead_code)]

const TEN: f32 = 10.0;

pub fn approx_equals(a: f32, b: f32) -> bool {
    (a - b).abs() < TEN.powi(-5)
}

pub fn round(n: f32, digits: i32) -> f32 {
    let scale = TEN.powi(digits);
    (n * scale).round() / scale
}

pub fn clamp(n: i32, min: i32, max: i32) -> i32 {
    i32::min(i32::max(n, min), max)
}

pub fn between(x: f32, a: f32, b: f32) -> bool {
    x >= a && x <= b
}

pub fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    // scale, bias and saturate x to 0..1 range
    let x = x * x * (3.0 - 2.0 * x);
    // evaluate polynomial
    (edge0 * x) + (edge1 * (1.0 - x))
}

#[allow(clippy::too_many_arguments)]
pub fn smooth_interpolation(
    bottom_left: f64,
    top_left: f64,
    bottom_right: f64,
    top_right: f64,
    x_min: f64,
    x_max: f64,
    z_min: f64,
    z_max: f64,
    x: f64,
    z: f64,
) -> f64 {
    let width = x_max - x_min;
    let height = z_max - z_min;
    let x_val = 1.0 - (x - x_min) / width;
    let z_val = 1.0 - (z - z_min) / height;

    let a = smoothstep(bottom_left, bottom_right, x_val);
    let b = smoothstep(top_left, top_right, x_val);

    smoothstep(a, b, z_val)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approx_equals_works() {
        assert!(approx_equals(0.000001, 0.000002),);
        assert!(!approx_equals(0.001, 0.00002),);
    }

    #[test]
    fn round_works() {
        let number = 10.123123;

        assert!((round(number, 10) - number).abs() < f32::EPSILON);
        assert!((round(number, 1) - 10.1).abs() < f32::EPSILON);
    }

    #[test]
    fn clamp_works() {
        let number = 40;

        assert_eq!(clamp(number, 10, 50), number);
        assert_eq!(clamp(number, 10, 30), 30);
        assert_eq!(clamp(number, 50, 60), 50);
    }
}
