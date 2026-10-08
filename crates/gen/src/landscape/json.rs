//! The strict spec reader: RFC 8259 JSON into a `serde_json::Value`, with
//! numbers read correctly rounded on every platform and without enabling
//! any serde_json feature.
//!
//! serde_json's own parser, without its `float_roundtrip` feature, may
//! round a decimal float to a neighbouring `f64`, and turning that feature
//! on would change how every crate in a consumer's build parses its own
//! JSON (Cargo unifies features). So the landscape spec has its own number
//! path (docs/landscape.md, section 2.4.3):
//!
//! - integer literals that fit `i64` or `u64` stay integers;
//! - every literal with a fraction or an exponent goes through Rust's
//!   `f64::from_str`, which is correctly rounded on every platform, and is
//!   stored with `serde_json::Number::from_f64`, which keeps the bits.
//!
//! A JSON twin written by the canonical writer ([`super::canon`]) therefore
//! reads back to exactly the `f64` bits of the Rust builder's literals.
//!
//! The reader is also stricter than RFC 8259 requires, because a spec is a
//! world's identity: it refuses duplicate object keys (which a map would
//! silently collapse), `NaN` and `Infinity` literals, trailing commas,
//! comments, leading zeros, lone surrogates, control characters in strings,
//! trailing content after the value, and nesting deeper than
//! [`MAX_DEPTH`]. Errors carry the line and column of the offending byte.
//!
//! Typed deserialization then runs through
//! [`serde_path_to_error`], so a bad field reads like
//! `frame.sea: unknown variant "AboveSeaLevel"` (see [`from_value`]).

use std::fmt;

use serde::de::DeserializeOwned;
use serde_json::{Map, Number, Value};

/// The deepest nesting of arrays and objects the reader accepts.
pub const MAX_DEPTH: usize = 64;

/// A reading or typing failure, with where it happened.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JsonError {
    /// `line:column` (1-based) for syntax errors, or the field path of a
    /// typing error (`nodes.canyons.params.depth.1`); empty at the root.
    pub at: String,
    /// What went wrong.
    pub message: String,
}

impl fmt::Display for JsonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.at.is_empty() {
            write!(f, "{}", self.message)
        } else {
            write!(f, "{}: {}", self.at, self.message)
        }
    }
}

impl std::error::Error for JsonError {}

/// Read one JSON document strictly (see the module docs).
pub fn parse(text: &str) -> Result<Value, JsonError> {
    let mut p = Parser {
        bytes: text.as_bytes(),
        pos: 0,
        depth: 0,
    };
    p.skip_ws();
    let value = p.value()?;
    p.skip_ws();
    if p.pos != p.bytes.len() {
        return Err(p.error("trailing content after the JSON value"));
    }
    Ok(value)
}

/// Deserialize a typed value from `value`, reporting the path of the field
/// that failed (`frame.sea`, `roles.snow.fallback`, `fields.ground.graph`).
pub fn from_value<T: DeserializeOwned>(value: Value) -> Result<T, JsonError> {
    serde_path_to_error::deserialize(value).map_err(|e| {
        let path = e.path().to_string();
        JsonError {
            at: if path == "." { String::new() } else { path },
            message: e.into_inner().to_string(),
        }
    })
}

/// [`parse`] then [`from_value`].
pub fn from_str<T: DeserializeOwned>(text: &str) -> Result<T, JsonError> {
    from_value(parse(text)?)
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
    depth: usize,
}

impl Parser<'_> {
    fn error(&self, message: impl Into<String>) -> JsonError {
        let upto = &self.bytes[..Ord::min(self.pos, self.bytes.len())];
        let line = 1 + upto.iter().filter(|&&b| b == b'\n').count();
        let column = 1 + upto.iter().rev().take_while(|&&b| b != b'\n').count();
        JsonError {
            at: format!("{line}:{column}"),
            message: message.into(),
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.peek() {
            self.pos += 1;
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), JsonError> {
        if self.peek() == Some(byte) {
            self.pos += 1;
            Ok(())
        } else {
            Err(self.error(format!("expected '{}'", byte as char)))
        }
    }

    fn literal(&mut self, word: &str, value: Value) -> Result<Value, JsonError> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(self.error("invalid literal (NaN, Infinity and comments are refused)"))
        }
    }

    fn enter(&mut self) -> Result<(), JsonError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(self.error(format!("nesting deeper than {MAX_DEPTH}")));
        }
        Ok(())
    }

    fn value(&mut self) -> Result<Value, JsonError> {
        match self.peek() {
            None => Err(self.error("unexpected end of input")),
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => Ok(Value::String(self.string()?)),
            Some(b't') => self.literal("true", Value::Bool(true)),
            Some(b'f') => self.literal("false", Value::Bool(false)),
            Some(b'n') => self.literal("null", Value::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(_) => {
                Err(self.error("unexpected character (NaN, Infinity and comments are refused)"))
            }
        }
    }

    fn object(&mut self) -> Result<Value, JsonError> {
        self.enter()?;
        self.pos += 1;
        let mut map = Map::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            self.depth -= 1;
            return Ok(Value::Object(map));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(self.error(if self.peek() == Some(b'}') {
                    "trailing comma in object"
                } else {
                    "expected a string key"
                }));
            }
            let key_at = self.pos;
            let key = self.string()?;
            if map.contains_key(&key) {
                self.pos = key_at;
                return Err(self.error(format!("duplicate key {key:?}")));
            }
            self.skip_ws();
            self.expect(b':')?;
            self.skip_ws();
            let value = self.value()?;
            map.insert(key, value);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    self.depth -= 1;
                    return Ok(Value::Object(map));
                }
                _ => return Err(self.error("expected ',' or '}'")),
            }
        }
    }

    fn array(&mut self) -> Result<Value, JsonError> {
        self.enter()?;
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            self.depth -= 1;
            return Ok(Value::Array(items));
        }
        loop {
            self.skip_ws();
            if self.peek() == Some(b']') {
                return Err(self.error("trailing comma in array"));
            }
            items.push(self.value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    self.depth -= 1;
                    return Ok(Value::Array(items));
                }
                _ => return Err(self.error("expected ',' or ']'")),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, JsonError> {
        let mut v = 0u32;
        for _ in 0..4 {
            let d = match self.peek() {
                Some(b @ b'0'..=b'9') => (b - b'0') as u32,
                Some(b @ b'a'..=b'f') => (b - b'a' + 10) as u32,
                Some(b @ b'A'..=b'F') => (b - b'A' + 10) as u32,
                _ => return Err(self.error("invalid \\u escape")),
            };
            v = v * 16 + d;
            self.pos += 1;
        }
        Ok(v)
    }

    fn string(&mut self) -> Result<String, JsonError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let start = self.pos;
            while let Some(b) = self.peek() {
                if b == b'"' || b == b'\\' || b < 0x20 {
                    break;
                }
                self.pos += 1;
            }
            // The input is a &str, so any run between ASCII delimiters is
            // valid UTF-8.
            out.push_str(std::str::from_utf8(&self.bytes[start..self.pos]).expect("utf-8 input"));
            match self.peek() {
                None => return Err(self.error("unterminated string")),
                Some(b'"') => {
                    self.pos += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.pos += 1;
                    let c = match self.peek() {
                        Some(b'"') => '"',
                        Some(b'\\') => '\\',
                        Some(b'/') => '/',
                        Some(b'b') => '\u{8}',
                        Some(b'f') => '\u{c}',
                        Some(b'n') => '\n',
                        Some(b'r') => '\r',
                        Some(b't') => '\t',
                        Some(b'u') => {
                            self.pos += 1;
                            let hi = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&hi) {
                                if !self.bytes[self.pos..].starts_with(b"\\u") {
                                    return Err(self.error("lone high surrogate"));
                                }
                                self.pos += 2;
                                let lo = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&lo) {
                                    return Err(self.error("invalid low surrogate"));
                                }
                                0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
                            } else if (0xDC00..0xE000).contains(&hi) {
                                return Err(self.error("lone low surrogate"));
                            } else {
                                hi
                            };
                            out.push(char::from_u32(code).expect("valid scalar"));
                            continue;
                        }
                        _ => return Err(self.error("invalid escape")),
                    };
                    self.pos += 1;
                    out.push(c);
                }
                Some(_) => return Err(self.error("control character in string")),
            }
        }
    }

    fn number(&mut self) -> Result<Value, JsonError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => {
                self.pos += 1;
                if let Some(b'0'..=b'9') = self.peek() {
                    return Err(self.error("leading zero in number"));
                }
            }
            Some(b'1'..=b'9') => {
                while let Some(b'0'..=b'9') = self.peek() {
                    self.pos += 1;
                }
            }
            _ => return Err(self.error("invalid number")),
        }
        let mut is_float = false;
        if self.peek() == Some(b'.') {
            is_float = true;
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("expected a digit after '.'"));
            }
            while let Some(b'0'..=b'9') = self.peek() {
                self.pos += 1;
            }
        }
        if let Some(b'e' | b'E') = self.peek() {
            is_float = true;
            self.pos += 1;
            if let Some(b'+' | b'-') = self.peek() {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("expected a digit in the exponent"));
            }
            while let Some(b'0'..=b'9') = self.peek() {
                self.pos += 1;
            }
        }
        let text = std::str::from_utf8(&self.bytes[start..self.pos]).expect("ascii");
        if !is_float {
            if let Ok(v) = text.parse::<u64>() {
                return Ok(Value::Number(v.into()));
            }
            if let Ok(v) = text.parse::<i64>() {
                return Ok(Value::Number(v.into()));
            }
            // An integer literal beyond 64 bits reads as the nearest f64.
        }
        // Rust's float parser is correctly rounded on every platform.
        let v: f64 = text.parse().map_err(|_| self.error("invalid number"))?;
        let number = Number::from_f64(v)
            .ok_or_else(|| self.error("number out of range (it would read as infinity)"))?;
        Ok(Value::Number(number))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers_stay_integers_and_floats_keep_their_bits() {
        let v =
            parse(r#"{"a": 1, "b": -7, "c": 1.0, "d": 0.1, "e": 18446744073709551615}"#).unwrap();
        assert!(v["a"].is_u64());
        assert!(v["b"].is_i64());
        assert!(v["c"].is_f64());
        assert_eq!(v["d"].as_f64().unwrap().to_bits(), 0.1f64.to_bits());
        assert_eq!(v["e"].as_u64(), Some(u64::MAX));
    }

    #[test]
    fn refusals_are_positioned() {
        let e = parse("{\n  \"a\": 1,\n  \"a\": 2\n}").unwrap_err();
        assert_eq!(e.at, "3:3");
        assert!(e.message.contains("duplicate key"));
        for bad in [
            "[1,]",
            "{\"a\":1,}",
            "NaN",
            "[Infinity]",
            "[-Infinity]",
            "01",
            "1.",
            "1e",
            "\"\\ud800\"",
            "[1] 2",
            "// x\n1",
            "\"a\u{1}\"",
            "1e400",
        ] {
            assert!(parse(bad).is_err(), "accepted {bad:?}");
        }
        let deep = "[".repeat(MAX_DEPTH + 1) + &"]".repeat(MAX_DEPTH + 1);
        assert!(parse(&deep).unwrap_err().message.contains("nesting"));
        let ok = "[".repeat(MAX_DEPTH) + &"]".repeat(MAX_DEPTH);
        assert!(parse(&ok).is_ok());
    }
}
