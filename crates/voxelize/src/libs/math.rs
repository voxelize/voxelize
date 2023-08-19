#![allow(dead_code)]

const TEN: f32 = 10.0;

/// Test if two numbers are equal within a given tolerance, which by default is `1e-5`.
pub fn approx_equals(a: f32, b: f32) -> bool {
    (a - b).abs() < TEN.powi(-5)
}

/// Round a float to a certain number of decimal places.
pub fn round(n: f32, digits: i32) -> f32 {
    let scale = TEN.powi(digits);
    (n * scale).round() / scale
}

/// Whether or not is a number within a range.
pub fn between(x: f32, a: f32, b: f32) -> bool {
    x >= a && x <= b
}
