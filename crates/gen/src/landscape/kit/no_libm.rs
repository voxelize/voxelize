//! A scanner for calls into the platform maths library.
//!
//! Transcendental `f64` methods (`sin`, `powf`, `hypot`, ...) are free to
//! differ in their last bits between platforms and library versions, and
//! `mul_add` fuses a rounding away, so code that promises the same bits
//! everywhere must not call them. This scanner reads Rust source with its
//! comments, strings and character literals blanked out, and reports every
//! call written `.name(` or `::name(` for a name in [`LIBM_METHODS`], plus
//! any mention of `mul_add`.
//!
//! It is plain text processing with no dependency on the rest of the crate,
//! so `tests/no_libm.rs` includes this file directly and runs in every
//! build, and the kit's `assert_no_libm!` gives game crates the same check.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// Floating-point methods backed by the platform maths library (or by a
/// fused multiply-add).
pub const LIBM_METHODS: &[&str] = &[
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh",
    "atanh", "sin_cos", "exp", "exp2", "exp_m1", "ln", "log", "log2", "log10", "ln_1p", "powf",
    "powi", "hypot", "cbrt", "mul_add", "gamma", "ln_gamma",
];

/// One call found.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct LibmHit {
    pub file: PathBuf,
    /// 1-based line number.
    pub line: usize,
    /// The method called.
    pub call: String,
    /// The source line, trimmed.
    pub text: String,
}

/// `src` with comments, string literals and character literals replaced
/// by spaces (line breaks kept), so only code remains.
pub fn strip_non_code(src: &str) -> String {
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let blank = |c: char| if c == '\n' { '\n' } else { ' ' };
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            let mut depth = 0;
            while i < chars.len() {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    depth += 1;
                    out.push_str("  ");
                    i += 2;
                } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    out.push_str("  ");
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    out.push(blank(chars[i]));
                    i += 1;
                }
            }
        } else if (c == 'r' || (c == 'b' && next == Some('r')))
            && !prev_is_ident(&chars, i)
            && raw_string_hashes(&chars, if c == 'b' { i + 1 } else { i }).is_some()
        {
            let start = if c == 'b' { i + 1 } else { i };
            let hashes = raw_string_hashes(&chars, start).unwrap();
            // r, hashes, opening quote
            let body = start + 1 + hashes + 1;
            for &ch in &chars[i..body] {
                out.push(blank(ch));
            }
            i = body;
            loop {
                if i >= chars.len() {
                    break;
                }
                if chars[i] == '"' && (0..hashes).all(|h| chars.get(i + 1 + h) == Some(&'#')) {
                    for _ in 0..=hashes {
                        out.push(' ');
                    }
                    i += 1 + hashes;
                    break;
                }
                out.push(blank(chars[i]));
                i += 1;
            }
        } else if c == '"' {
            out.push(' ');
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                if ch == '\\' {
                    out.push(' ');
                    if let Some(&escaped) = chars.get(i + 1) {
                        out.push(blank(escaped));
                    }
                    i += 2;
                    continue;
                }
                out.push(blank(ch));
                i += 1;
                if ch == '"' {
                    break;
                }
            }
        } else if c == '\'' {
            // A character literal ('x', '\n', '\u{..}'); a lifetime has no
            // closing quote right after its first character.
            if next == Some('\\') {
                // Past the backslash and the escaped character (which may
                // itself be a quote), to the closing quote.
                let mut j = i + 3;
                while j < chars.len() && chars[j] != '\'' {
                    j += 1;
                }
                for &ch in &chars[i..=j.min(chars.len() - 1)] {
                    out.push(blank(ch));
                }
                i = j + 1;
            } else if chars.get(i + 2) == Some(&'\'') {
                out.push_str("   ");
                i += 3;
            } else {
                out.push(c);
                i += 1;
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

fn prev_is_ident(chars: &[char], i: usize) -> bool {
    i > 0 && (chars[i - 1].is_alphanumeric() || chars[i - 1] == '_')
}

/// If a raw string starts at `i` (`r`, then `#`s, then `"`), its `#` count.
fn raw_string_hashes(chars: &[char], i: usize) -> Option<usize> {
    if chars.get(i) != Some(&'r') {
        return None;
    }
    let mut j = i + 1;
    while chars.get(j) == Some(&'#') {
        j += 1;
    }
    (chars.get(j) == Some(&'"')).then_some(j - i - 1)
}

/// Every libm call in already-stripped code: `(line, method)`.
pub fn find_calls(code: &str) -> Vec<(usize, String)> {
    let mut hits = Vec::new();
    for (n, line) in code.lines().enumerate() {
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i].is_alphabetic() || chars[i] == '_' {
                let start = i;
                while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                    i += 1;
                }
                let name: String = chars[start..i].iter().collect();
                if !LIBM_METHODS.contains(&name.as_str()) {
                    continue;
                }
                let before: String = chars[..start]
                    .iter()
                    .collect::<String>()
                    .trim_end()
                    .to_string();
                let after = chars[i..].iter().find(|c| !c.is_whitespace());
                let called =
                    (before.ends_with('.') || before.ends_with("::")) && after == Some(&'(');
                if called || name == "mul_add" {
                    hits.push((n + 1, name));
                }
            } else {
                i += 1;
            }
        }
    }
    hits
}

/// Every libm call in one file.
pub fn scan_file(path: &Path) -> Vec<LibmHit> {
    let src =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let lines: Vec<&str> = src.lines().collect();
    find_calls(&strip_non_code(&src))
        .into_iter()
        .map(|(line, call)| LibmHit {
            file: path.to_path_buf(),
            line,
            call,
            text: lines
                .get(line - 1)
                .map_or(String::new(), |l| l.trim().to_string()),
        })
        .collect()
}

/// Every `.rs` file under `dir`, sorted.
pub fn rust_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let entries = std::fs::read_dir(&d).unwrap_or_else(|e| panic!("read {}: {e}", d.display()));
        for entry in entries {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

/// Every libm call in every `.rs` file under `dir`.
pub fn scan_dir(dir: &Path) -> Vec<LibmHit> {
    rust_files(dir).iter().flat_map(|f| scan_file(f)).collect()
}

/// A readable list of hits.
pub fn report(hits: &[LibmHit]) -> String {
    let mut out = format!("{} call(s) into the platform maths library:\n", hits.len());
    for h in hits {
        let _ = writeln!(
            out,
            "  {}:{}: .{}( in `{}`",
            h.file.display(),
            h.line,
            h.call,
            h.text
        );
    }
    out
}
