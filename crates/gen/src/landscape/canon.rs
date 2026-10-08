//! The canonical writer: one byte string per value, whatever map type,
//! key order, serde_json version or float formatter the build carries.
//!
//! A typed value is converted with `serde_json::to_value`, which stores
//! floats exactly and formats nothing, and the result is written by this
//! module, never by serde_json's formatter:
//!
//! - objects with keys sorted by their UTF-8 bytes, whatever the map type
//!   (serde_json's `preserve_order` feature, if some crate in the build
//!   turns it on, changes nothing here);
//! - no whitespace;
//! - strings with the minimal escapes: `"`, `\`, and control characters
//!   (`\b \f \n \r \t`, the rest as `\u00XX`); everything else verbatim;
//! - integers in decimal;
//! - floats through `ryu::Buffer::format_finite`, a direct, pinned
//!   dependency, with `-0.0` written as `0.0`. A float that happens to be
//!   integral keeps its float spelling (`1.0`), so an `f64` field always
//!   reads back as a float.
//!
//! [`spec_hash`] is the FNV-1a hash of these bytes. [`CANON_VERSION`]
//! names the formatting rules; it is part of a landscape's identity and
//! bumps whenever any rule above changes.

use serde::Serialize;
use serde_json::Value;

use crate::stream::fnv1a_64;

/// The version of the canonical formatting rules (part of identity).
pub const CANON_VERSION: u32 = 1;

/// Write `value` canonically.
pub fn write_value(value: &Value) -> String {
    let mut out = String::new();
    write_into(value, &mut out);
    out
}

/// Convert a typed value with `to_value` and write it canonically.
pub fn to_canonical<T: Serialize + ?Sized>(value: &T) -> Result<String, serde_json::Error> {
    Ok(write_value(&serde_json::to_value(value)?))
}

/// `value` with the canonical rules (sorted keys, pinned number and string
/// spellings) but laid out on lines with two-space indents, for files
/// people read and diff. It reads back to the same value, so it hashes the
/// same as the compact form.
pub fn write_pretty(value: &Value) -> String {
    let mut out = String::new();
    pretty_into(value, 0, &mut out);
    out
}

fn pretty_into(value: &Value, depth: usize, out: &mut String) {
    let pad = |d: usize, out: &mut String| {
        for _ in 0..d {
            out.push_str("  ");
        }
    };
    match value {
        Value::Array(items) if !items.is_empty() => {
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                pad(depth + 1, out);
                pretty_into(item, depth + 1, out);
                if i + 1 < items.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            pad(depth, out);
            out.push(']');
        }
        Value::Object(map) if !map.is_empty() => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
            out.push_str("{\n");
            for (i, key) in keys.iter().enumerate() {
                pad(depth + 1, out);
                write_string(key, out);
                out.push_str(": ");
                pretty_into(&map[*key], depth + 1, out);
                if i + 1 < keys.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            pad(depth, out);
            out.push('}');
        }
        other => write_into(other, out),
    }
}

/// The FNV-1a hash of a value's canonical bytes.
pub fn hash_value(value: &Value) -> u64 {
    fnv1a_64(write_value(value).as_bytes())
}

/// The FNV-1a hash of a typed value's canonical bytes.
pub fn spec_hash<T: Serialize + ?Sized>(value: &T) -> Result<u64, serde_json::Error> {
    Ok(hash_value(&serde_json::to_value(value)?))
}

/// The canonical spelling of one finite float.
pub fn format_f64(v: f64) -> String {
    let v = if v == 0.0 { 0.0 } else { v };
    let mut buffer = ryu::Buffer::new();
    buffer.format_finite(v).to_string()
}

fn write_into(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else {
                // Without `arbitrary_precision` every other number is a
                // finite f64 (serde_json refuses NaN and infinity).
                let f = n.as_f64().expect("a finite float");
                out.push_str(&format_f64(f));
            }
        }
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_into(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_into(&map[key], out);
            }
            out.push('}');
        }
    }
}

fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_spellings() {
        let cases: [(f64, &str); 10] = [
            (1.0, "1.0"),
            (-0.0, "0.0"),
            (0.1, "0.1"),
            (1e16, "1e16"),
            (1.5e300, "1.5e300"),
            (123456789.0, "123456789.0"),
            (0.30000000000000004, "0.30000000000000004"),
            (5e-324, "5e-324"),
            (-2.5, "-2.5"),
            (1e-7, "1e-7"),
        ];
        for (v, s) in cases {
            assert_eq!(format_f64(v), s);
        }
        let v = serde_json::json!({"b": [1, -2, 1.0], "a": "q\"\n\u{1}é", "": null});
        assert_eq!(
            write_value(&v),
            r#"{"":null,"a":"q\"\n\u0001é","b":[1,-2,1.0]}"#
        );
    }
}
