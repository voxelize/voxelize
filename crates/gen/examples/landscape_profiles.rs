//! Renders the landscape kernel's worn profiles as one PNG sheet: each
//! cross-section filled, its analytic slope on a second axis, and every
//! join marked with the measured value and slope jumps across it.
//!
//! An offline kernel plot, not an in-engine capture.
//!
//! `cargo run -p voxelize-gen --release --features unstable-landscape --example landscape_profiles -- [--out <png>]`

use std::path::PathBuf;

use voxelize_gen::landscape::profile::{
    Cone, DuneWave, Face, FaceSpec, Profile, SWall, SlotLedge, SlotSection, SlotSpec, Wall,
};

/// Output pixels per sheet pixel while drawing; the sheet is box-filtered
/// down at the end, which anti-aliases every curve.
const SS: i32 = 2;
const W: i32 = 1880;
const H: i32 = 1040;

type Rgb = [u8; 3];
const PAPER: Rgb = [246, 244, 239];
const PANEL: Rgb = [255, 255, 255];
const FRAME: Rgb = [214, 210, 202];
const GRID: Rgb = [232, 230, 226];
const ROCK: Rgb = [208, 192, 166];
const ROCK_EDGE: Rgb = [70, 58, 44];
const SLOPE: Rgb = [38, 110, 178];
const JOIN: Rgb = [196, 62, 48];
const WATER: Rgb = [186, 214, 232];
const INK: Rgb = [34, 32, 30];
const MUTED: Rgb = [118, 114, 108];
const FAINT: Rgb = [176, 160, 136];

struct Canvas {
    w: i32,
    h: i32,
    px: Vec<f32>,
}

impl Canvas {
    fn new(w: i32, h: i32, bg: Rgb) -> Self {
        let mut px = Vec::with_capacity((w * h * 3) as usize);
        for _ in 0..w * h {
            px.extend(bg.iter().map(|&c| c as f32));
        }
        Self { w, h, px }
    }

    fn blend(&mut self, x: i32, y: i32, c: Rgb, a: f32) {
        if x < 0 || y < 0 || x >= self.w || y >= self.h {
            return;
        }
        let i = ((y * self.w + x) * 3) as usize;
        for (p, &ch) in self.px[i..i + 3].iter_mut().zip(&c) {
            *p += (ch as f32 - *p) * a;
        }
    }

    /// Fill a rectangle given in sheet pixels.
    fn rect(&mut self, x0: f64, y0: f64, x1: f64, y1: f64, c: Rgb) {
        let (a, b) = ((x0 * SS as f64) as i32, (y0 * SS as f64) as i32);
        let (e, f) = ((x1 * SS as f64) as i32, (y1 * SS as f64) as i32);
        for y in b.min(f)..b.max(f) {
            for x in a.min(e)..a.max(e) {
                self.blend(x, y, c, 1.0);
            }
        }
    }

    /// A round pen dot of radius `r` sheet pixels at a sheet position.
    fn dot(&mut self, x: f64, y: f64, r: f64, c: Rgb) {
        let (cx, cy, rr) = (x * SS as f64, y * SS as f64, r * SS as f64);
        for py in (cy - rr).floor() as i32..=(cy + rr).ceil() as i32 {
            for px in (cx - rr).floor() as i32..=(cx + rr).ceil() as i32 {
                let (dx, dy) = (px as f64 + 0.5 - cx, py as f64 + 0.5 - cy);
                if dx * dx + dy * dy <= rr * rr {
                    self.blend(px, py, c, 1.0);
                }
            }
        }
    }

    fn line(&mut self, a: (f64, f64), b: (f64, f64), r: f64, c: Rgb) {
        let len = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
        let steps = (len * 4.0).ceil().max(1.0) as i32;
        for i in 0..=steps {
            let t = i as f64 / steps as f64;
            self.dot(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t, r, c);
        }
    }

    fn dashed_vline(&mut self, x: f64, y0: f64, y1: f64, c: Rgb) {
        let mut y = y0;
        while y < y1 {
            self.line((x, y), (x, (y + 5.0).min(y1)), 0.6, c);
            y += 9.0;
        }
    }

    fn text(&mut self, x: f64, y: f64, scale: i32, s: &str, c: Rgb) -> f64 {
        let mut pen = x;
        for ch in s.chars() {
            let rows = glyph(ch.to_ascii_uppercase());
            for (r, row) in rows.iter().enumerate() {
                for (k, cell) in row.chars().enumerate() {
                    if cell == '#' {
                        self.rect(
                            pen + (k as i32 * scale) as f64,
                            y + (r as i32 * scale) as f64,
                            pen + ((k as i32 + 1) * scale) as f64,
                            y + ((r as i32 + 1) * scale) as f64,
                            c,
                        );
                    }
                }
            }
            pen += (6 * scale) as f64;
        }
        pen
    }

    fn text_width(s: &str, scale: i32) -> f64 {
        (s.chars().count() as i32 * 6 * scale) as f64
    }

    fn save(&self, path: &PathBuf) {
        let (w, h) = (self.w / SS, self.h / SS);
        let mut out = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            for x in 0..w {
                for k in 0..3 {
                    let mut sum = 0.0;
                    for dy in 0..SS {
                        for dx in 0..SS {
                            sum +=
                                self.px[(((y * SS + dy) * self.w + x * SS + dx) * 3 + k) as usize];
                        }
                    }
                    out.push((sum / (SS * SS) as f32).round() as u8);
                }
            }
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("create output folder");
        }
        let file = std::fs::File::create(path).expect("create png");
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w as u32, h as u32);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header()
            .expect("png header")
            .write_image_data(&out)
            .expect("png data");
    }
}

/// A 5×7 bitmap font for capitals, digits and the punctuation the sheet
/// uses.
fn glyph(c: char) -> [&'static str; 7] {
    match c {
        'A' => [
            ".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#",
        ],
        'B' => [
            "####.", "#...#", "#...#", "####.", "#...#", "#...#", "####.",
        ],
        'C' => [
            ".###.", "#...#", "#....", "#....", "#....", "#...#", ".###.",
        ],
        'D' => [
            "####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####.",
        ],
        'E' => [
            "#####", "#....", "#....", "####.", "#....", "#....", "#####",
        ],
        'F' => [
            "#####", "#....", "#....", "####.", "#....", "#....", "#....",
        ],
        'G' => [
            ".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####",
        ],
        'H' => [
            "#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#",
        ],
        'I' => [
            ".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###.",
        ],
        'J' => [
            "..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##..",
        ],
        'K' => [
            "#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#",
        ],
        'L' => [
            "#....", "#....", "#....", "#....", "#....", "#....", "#####",
        ],
        'M' => [
            "#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#",
        ],
        'N' => [
            "#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#",
        ],
        'O' => [
            ".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.",
        ],
        'P' => [
            "####.", "#...#", "#...#", "####.", "#....", "#....", "#....",
        ],
        'Q' => [
            ".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#",
        ],
        'R' => [
            "####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#",
        ],
        'S' => [
            ".####", "#....", "#....", ".###.", "....#", "....#", "####.",
        ],
        'T' => [
            "#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#..",
        ],
        'U' => [
            "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.",
        ],
        'V' => [
            "#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#..",
        ],
        'W' => [
            "#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#.",
        ],
        'X' => [
            "#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#",
        ],
        'Y' => [
            "#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..",
        ],
        'Z' => [
            "#####", "....#", "...#.", "..#..", ".#...", "#....", "#####",
        ],
        '0' => [
            ".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###.",
        ],
        '1' => [
            "..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###.",
        ],
        '2' => [
            ".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####",
        ],
        '3' => [
            "#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###.",
        ],
        '4' => [
            "...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#.",
        ],
        '5' => [
            "#####", "#....", "####.", "....#", "....#", "#...#", ".###.",
        ],
        '6' => [
            "..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###.",
        ],
        '7' => [
            "#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#...",
        ],
        '8' => [
            ".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###.",
        ],
        '9' => [
            ".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##..",
        ],
        '.' => [
            ".....", ".....", ".....", ".....", ".....", ".##..", ".##..",
        ],
        ',' => [
            ".....", ".....", ".....", ".....", ".##..", "..#..", ".#...",
        ],
        '-' => [
            ".....", ".....", ".....", "#####", ".....", ".....", ".....",
        ],
        '+' => [
            ".....", "..#..", "..#..", "#####", "..#..", "..#..", ".....",
        ],
        '=' => [
            ".....", ".....", "#####", ".....", "#####", ".....", ".....",
        ],
        '(' => [
            "...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#.",
        ],
        ')' => [
            ".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#...",
        ],
        ':' => [
            ".....", ".##..", ".##..", ".....", ".##..", ".##..", ".....",
        ],
        '/' => [
            ".....", "....#", "...#.", "..#..", ".#...", "#....", ".....",
        ],
        '%' => [
            "##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##",
        ],
        '<' => [
            "...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#.",
        ],
        '>' => [
            ".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#...",
        ],
        '_' => [
            ".....", ".....", ".....", ".....", ".....", ".....", "#####",
        ],
        '\'' => [
            "..#..", "..#..", ".#...", ".....", ".....", ".....", ".....",
        ],
        '*' => [
            ".....", "..#..", "#.#.#", ".###.", "#.#.#", "..#..", ".....",
        ],
        _ => [
            ".....", ".....", ".....", ".....", ".....", ".....", ".....",
        ],
    }
}

/// One panel's content.
struct Plot<'a> {
    number: u32,
    title: &'a str,
    params: String,
    recipe: &'a str,
    /// Height and slope at x.
    sample: Box<dyn Fn(f64) -> (f64, f64) + 'a>,
    /// Faint variants for comparison.
    variants: Vec<Box<dyn Fn(f64) -> f64 + 'a>>,
    x: (f64, f64),
    y: (f64, f64),
    slope_max: f64,
    /// Join positions, with their value and slope jumps.
    joins: Vec<(f64, f64, f64)>,
    x_label: &'a str,
    y_label: &'a str,
    sea: bool,
}

fn joins_of(p: &dyn Profile, map: impl Fn(f64) -> f64) -> Vec<(f64, f64, f64)> {
    (0..p.knot_count())
        .map(|i| {
            let k = p.knot(i);
            let (a, b) = (p.piece(i, k), p.piece(i + 1, k));
            (map(k), (a.0 - b.0).abs(), (a.1 - b.1).abs())
        })
        .collect()
}

fn fmt_jump(v: f64) -> String {
    if v == 0.0 {
        "0".to_string()
    } else {
        format!("{v:.1e}")
    }
}

fn draw_panel(c: &mut Canvas, px: f64, py: f64, pw: f64, ph: f64, plot: &Plot) {
    c.rect(px, py, px + pw, py + ph, PANEL);
    for (x0, y0, x1, y1) in [
        (px, py, px + pw, py + 1.0),
        (px, py + ph - 1.0, px + pw, py + ph),
        (px, py, px + 1.0, py + ph),
        (px + pw - 1.0, py, px + pw, py + ph),
    ] {
        c.rect(x0, y0, x1, y1, FRAME);
    }
    let head = format!("{}  {}", plot.number, plot.title);
    let end = c.text(px + 16.0, py + 14.0, 3, &head, INK);
    c.text(end + 14.0, py + 21.0, 2, &plot.params, MUTED);
    // The recipe, wrapped to the panel.
    let max_chars = ((pw - 32.0) / 12.0) as usize;
    let mut line = String::new();
    let mut y = py + 44.0;
    for word in plot.recipe.split(' ') {
        if !line.is_empty() && line.len() + 1 + word.len() > max_chars {
            c.text(px + 16.0, y, 2, &line, MUTED);
            y += 18.0;
            line.clear();
        }
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(word);
    }
    c.text(px + 16.0, y, 2, &line, MUTED);

    let (l, r, t, b) = (px + 64.0, px + pw - 64.0, py + 112.0, py + ph - 70.0);
    c.text(l - 48.0, t - 26.0, 2, plot.y_label, MUTED);
    let slope_label = "SLOPE";
    c.text(
        r + 52.0 - Canvas::text_width(slope_label, 2),
        t - 26.0,
        2,
        slope_label,
        SLOPE,
    );
    let sx = |x: f64| l + (x - plot.x.0) / (plot.x.1 - plot.x.0) * (r - l);
    let sy = |y: f64| b - (y - plot.y.0) / (plot.y.1 - plot.y.0) * (b - t);
    let ss = |s: f64| b - (s / plot.slope_max) * (b - t);

    // Grid at quarters of the height range, and the zero line.
    for i in 0..=4 {
        let y = plot.y.0 + (plot.y.1 - plot.y.0) * i as f64 / 4.0;
        c.rect(l, sy(y), r, sy(y) + 1.0, GRID);
        let label = format!("{y:.1}");
        c.text(
            l - 10.0 - Canvas::text_width(&label, 2),
            sy(y) - 7.0,
            2,
            &label,
            MUTED,
        );
        let s = plot.slope_max * (sy(y) - b) / (t - b) + 0.0;
        c.text(r + 10.0, sy(y) - 7.0, 2, &format!("{s:.1}"), SLOPE);
    }

    // The cross-section, filled one drawing column at a time.
    let (c0, c1) = ((l * SS as f64) as i32, (r * SS as f64) as i32);
    let bottom = (b * SS as f64) as i32;
    for col in c0..c1 {
        let cx = (col as f64 + 0.5) / SS as f64;
        let x = plot.x.0 + (cx - l) / (r - l) * (plot.x.1 - plot.x.0);
        let cy = sy((plot.sample)(x).0).max(t).min(b);
        for row in (cy * SS as f64) as i32..bottom {
            c.blend(col, row, ROCK, 1.0);
        }
    }
    if plot.sea {
        let x0 = plot.x.0;
        for col in (sx(x0) * SS as f64) as i32..(sx(0.0) * SS as f64) as i32 {
            for row in (sy(0.0) * SS as f64) as i32..bottom {
                c.blend(col, row, WATER, 0.85);
            }
        }
        c.text(sx(x0) + 6.0, sy(0.0) - 20.0, 2, "SEA", [70, 112, 146]);
    }
    let cols = ((r - l) * SS as f64) as i32;
    let mut prev: Option<(f64, f64)> = None;
    let mut prev_s: Option<(f64, f64)> = None;
    for i in 0..=cols {
        let x = plot.x.0 + (plot.x.1 - plot.x.0) * i as f64 / cols as f64;
        let (h, s) = (plot.sample)(x);
        let (cx, cy) = (sx(x), sy(h).max(t).min(b));
        if let Some(p) = prev {
            c.line(p, (cx, cy), 1.15, ROCK_EDGE);
        }
        prev = Some((cx, cy));
        // Steepness: the mirrored slot side and the dune's lee fall, so the
        // magnitude is what is drawn.
        let cs = ss(s.abs()).max(t - 4.0).min(b);
        if let Some(p) = prev_s {
            c.line(p, (cx, cs), 0.9, SLOPE);
        }
        prev_s = Some((cx, cs));
    }
    for v in &plot.variants {
        let mut prev: Option<(f64, f64)> = None;
        for i in 0..=cols / 2 {
            let x = plot.x.0 + (plot.x.1 - plot.x.0) * i as f64 / (cols / 2) as f64;
            let p = (sx(x), sy(v(x)).max(t).min(b));
            if let Some(q) = prev {
                c.line(q, p, 0.6, FAINT);
            }
            prev = Some(p);
        }
    }
    // Joins: dashed, with a dot on the curve.
    let mut worst = (0.0f64, 0.0f64);
    for &(x, dv, ds) in &plot.joins {
        c.dashed_vline(sx(x), t, b, JOIN);
        let (h, _) = (plot.sample)(x);
        c.dot(sx(x), sy(h), 3.2, JOIN);
        worst = (worst.0.max(dv), worst.1.max(ds));
    }
    c.rect(l, b, r, b + 1.5, INK);
    let xl = format!("{:.2}", plot.x.0);
    let xr = format!("{:.2}", plot.x.1);
    c.text(l, b + 10.0, 2, &xl, MUTED);
    c.text(r - Canvas::text_width(&xr, 2), b + 10.0, 2, &xr, MUTED);
    let label_w = Canvas::text_width(plot.x_label, 2);
    c.text(
        (l + r) * 0.5 - label_w * 0.5,
        b + 10.0,
        2,
        plot.x_label,
        MUTED,
    );
    let joins = format!(
        "{} JOIN{}, MAX JUMP: VALUE {}, SLOPE {}",
        plot.joins.len(),
        if plot.joins.len() == 1 { "" } else { "S" },
        fmt_jump(worst.0),
        fmt_jump(worst.1)
    );
    c.text(px + 16.0, py + ph - 30.0, 2, &joins, JOIN);
}

fn main() {
    let mut out = PathBuf::from("target/landscape/p1-profiles.png");
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--out") {
        out = PathBuf::from(args.get(i + 1).expect("--out needs a path"));
    }

    let wall = Wall::new(1.35, 0.07).unwrap();
    let wall_lo = Wall::new(1.0, 0.07).unwrap();
    let wall_hi = Wall::new(1.755, 0.07).unwrap();
    let cone = Cone::new(1.875, 0.94).unwrap();
    let cone_alt = Cone::new(1.9, 0.85).unwrap();
    let face_spec = FaceSpec {
        h: 60.0,
        ledge: 25.0,
        run1: 2.5,
        shelf: 3.0,
        run2: 3.5,
        rim: 5.0,
    };
    let face = Face::new(face_spec).unwrap();
    let face_flat = Face::new(FaceSpec {
        shelf: 0.0,
        ledge: 32.0,
        ..face_spec
    })
    .unwrap();
    let swall = SWall::new(0.42, 0.1).unwrap();
    let swall_plain = SWall::new(0.42, 0.0).unwrap();
    let swall_neg = SWall::new(0.42, -0.1875).unwrap();
    let slot_spec = SlotSpec {
        depth: 20.0,
        half: 2.2,
        flat: 0.85,
        ledge: Some(SlotLedge {
            width: 3.0,
            depth_share: 0.35,
            run: 0.8,
        }),
        lip: 2.0,
        lip_reach: 3.0,
        bench: 2.0,
        bench_reach: 9.0,
    };
    let slot_left = SlotSection::new(slot_spec).unwrap();
    // The other wall bulges 35% wider and has no ledge: sides are independent.
    let slot_right = SlotSection::new(SlotSpec {
        half: 2.2 * 1.35,
        ledge: None,
        ..slot_spec
    })
    .unwrap();
    let dune = DuneWave::new(0.72).unwrap();
    let dune_small = DuneWave::new(0.70).unwrap();

    let reach = slot_left.reach().max(slot_right.reach());
    let mut slot_joins = joins_of(&slot_left, |k| -k);
    slot_joins.extend(joins_of(&slot_right, |k| k));
    let mut dune_joins = Vec::new();
    for w in 0..3 {
        for (x, dv, ds) in joins_of(&dune, |k| k + w as f64) {
            dune_joins.push((x, dv, ds));
        }
        let (a, b) = (dune.piece(1, 1.0), dune.piece(0, 0.0));
        if w > 0 {
            dune_joins.push((w as f64, (a.0 - b.0).abs(), (a.1 - b.1).abs()));
        }
    }

    let plots = [
        Plot {
            number: 1,
            title: "WALL",
            params: "EXP 1.35  RIM ROUND 0.07".into(),
            recipe: "POW_SMOOTH(U, P), THEN A HERMITE RIM TO LEVEL. FAINT: P 1.0, 1.755",
            sample: Box::new(|u| wall.sample(u)),
            variants: vec![
                Box::new(|u| wall_lo.height(u)),
                Box::new(|u| wall_hi.height(u)),
            ],
            x: (-0.08, 1.08),
            y: (0.0, 1.1),
            slope_max: 2.4,
            joins: joins_of(&wall, |k| k),
            x_label: "FOOT TO RIM",
            y_label: "SHARE OF RISE",
            sea: false,
        },
        Plot {
            number: 2,
            title: "CONE",
            params: "EXP 1.875  SHOULDER 0.94".into(),
            recipe: "POW_SMOOTH(T, P), THEN A QUADRATIC SHOULDER. FAINT: 1.9 / 0.85",
            sample: Box::new(|t| cone.sample(t)),
            variants: vec![Box::new(|t| cone_alt.height(t))],
            x: (-0.08, 1.08),
            y: (0.0, 1.1),
            slope_max: 2.4,
            joins: joins_of(&cone, |k| k),
            x_label: "FOOT TO SUMMIT",
            y_label: "SHARE OF RISE",
            sea: false,
        },
        Plot {
            number: 3,
            title: "FACE",
            params: "H 60  LEDGE 25  SHELF 3  RIM 5".into(),
            recipe: "FOOT, WORN SHELF RISING 0.3, WALL BASE, RIM. FAINT: NO SHELF",
            // Seaward of the foot, a seabed 5 under the waterline.
            sample: Box::new(|sp| {
                if sp < 0.0 {
                    (-5.0, 0.0)
                } else {
                    face.sample(sp)
                }
            }),
            variants: vec![Box::new(|sp| face_flat.height(sp))],
            x: (-3.0, face.run() + 4.0),
            y: (-6.0, 66.0),
            slope_max: 24.0,
            joins: joins_of(&face, |k| k),
            x_label: "INTO THE LAND, BLOCKS",
            y_label: "BLOCKS OVER THE SEA",
            sea: true,
        },
        Plot {
            number: 4,
            title: "S-WALL",
            params: "SHARE 0.42  SLUMP 0.1".into(),
            recipe: "CALDERA: LEVEL FLOOR, SMOOTHSTEP WALL + C1 SLUMP. FAINT: 0, -0.1875",
            sample: Box::new(|r| swall.sample(r)),
            variants: vec![
                Box::new(|r| swall_plain.height(r)),
                Box::new(|r| swall_neg.height(r)),
            ],
            x: (0.3, 1.08),
            y: (0.0, 1.1),
            slope_max: 6.0,
            joins: joins_of(&swall, |k| k),
            x_label: "CENTRE TO RIM",
            y_label: "SHARE OF DEPTH",
            sea: false,
        },
        Plot {
            number: 5,
            title: "SLOT SECTION",
            params: "DEPTH 20  HALF 2.2 / 2.97".into(),
            recipe: "FLOOR, WALLS, LEDGE (LEFT), LIP AND BENCH; SIDES BULGE APART",
            sample: Box::new(|d| {
                if d < 0.0 {
                    let (h, s) = slot_left.sample(-d);
                    (h, -s)
                } else {
                    slot_right.sample(d)
                }
            }),
            variants: vec![],
            x: (-reach - 1.0, reach + 1.0),
            y: (-22.0, 2.0),
            slope_max: 160.0,
            joins: slot_joins,
            x_label: "ACROSS THE SLOT, BLOCKS",
            y_label: "BLOCKS FROM THE RIM",
            sea: false,
        },
        Plot {
            number: 6,
            title: "DUNE WAVE",
            params: "STOSS 0.72".into(),
            recipe:
                "SMOOTHERSTEP STOSS, SMOOTHSTEP LEE; LEVEL CRESTS AND TROUGHS. FAINT: 0.70 X 0.4",
            sample: Box::new(|u| dune.sample(u)),
            variants: vec![Box::new(|u| 0.4 * dune_small.sample(u * 2.3).0)],
            x: (0.0, 3.0),
            y: (0.0, 1.15),
            slope_max: 6.0,
            joins: dune_joins,
            x_label: "PHASE, WAVELENGTHS",
            y_label: "SHARE OF HEIGHT",
            sea: false,
        },
    ];

    let mut c = Canvas::new(W * SS, H * SS, PAPER);
    c.text(28.0, 22.0, 4, "LANDSCAPE KERNEL: WORN PROFILES", INK);
    c.text(28.0, 66.0, 2, "OFFLINE KERNEL PLOT - NOT IN-GAME.  EVERY PIECE STARTS FROM THE VALUE AND SLOPE THE PIECE BEFORE IT ENDS ON.", MUTED);
    let legend_y = 92.0;
    let mut x = 28.0;
    c.rect(x, legend_y, x + 26.0, legend_y + 14.0, ROCK);
    x = c.text(x + 34.0, legend_y, 2, "CROSS SECTION (LEFT AXIS)", INK) + 24.0;
    c.line((x, legend_y + 7.0), (x + 26.0, legend_y + 7.0), 1.0, SLOPE);
    x = c.text(
        x + 34.0,
        legend_y,
        2,
        "ANALYTIC STEEPNESS (RIGHT AXIS)",
        SLOPE,
    ) + 24.0;
    c.dot(x + 12.0, legend_y + 7.0, 3.2, JOIN);
    x = c.text(x + 30.0, legend_y, 2, "JOINS, WITH MEASURED JUMPS", JOIN) + 24.0;
    c.line((x, legend_y + 7.0), (x + 26.0, legend_y + 7.0), 0.6, FAINT);
    c.text(x + 34.0, legend_y, 2, "VARIANTS", FAINT);

    let (pw, ph) = (600.0, 430.0);
    let (gx, gy) = (20.0, 20.0);
    for (i, plot) in plots.iter().enumerate() {
        let (col, row) = ((i % 3) as f64, (i / 3) as f64);
        draw_panel(
            &mut c,
            20.0 + col * (pw + gx),
            126.0 + row * (ph + gy),
            pw,
            ph,
            plot,
        );
    }
    let worst = plots
        .iter()
        .flat_map(|p| p.joins.iter())
        .fold((0.0f64, 0.0f64), |w, &(_, dv, ds)| {
            (w.0.max(dv), w.1.max(ds))
        });
    let joins: usize = plots.iter().map(|p| p.joins.len()).sum();
    let foot = format!(
        "{joins} JOINS ACROSS 6 PROFILES: LARGEST VALUE JUMP {}, LARGEST SLOPE JUMP {} (THE CONTRACT IS 1E-12).",
        fmt_jump(worst.0),
        fmt_jump(worst.1)
    );
    c.text(28.0, H as f64 - 26.0, 2, &foot, INK);
    c.save(&out);
    println!(
        "wrote {} ({joins} joins, worst value jump {:e}, worst slope jump {:e})",
        out.display(),
        worst.0,
        worst.1
    );
}
