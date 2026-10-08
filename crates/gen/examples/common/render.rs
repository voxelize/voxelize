//! Shared offline drawing for the landscape examples: an RGB canvas with
//! the bitmap font, PNG encoding, hillshade, colour ramps, the offline
//! label, and the map layers both `landscape_render` and the showcase's
//! debug route draw (hillshade, node edges, claim weights).

#![allow(dead_code)]

use std::path::Path;

use voxelize_gen::landscape::Landscape;

use crate::font;

pub type Rgb = [u8; 3];

pub struct Canvas {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

impl Canvas {
    pub fn new(w: usize, h: usize, bg: Rgb) -> Self {
        let mut px = Vec::with_capacity(w * h * 3);
        for _ in 0..w * h {
            px.extend_from_slice(&bg);
        }
        Self { w, h, px }
    }

    pub fn set(&mut self, x: usize, y: usize, c: Rgb) {
        if x < self.w && y < self.h {
            let i = (y * self.w + x) * 3;
            self.px[i..i + 3].copy_from_slice(&c);
        }
    }

    pub fn rect(&mut self, x0: usize, y0: usize, x1: usize, y1: usize, c: Rgb) {
        for y in y0..y1 {
            for x in x0..x1 {
                self.set(x, y, c);
            }
        }
    }

    pub fn text(&mut self, x: usize, y: usize, scale: usize, s: &str, c: Rgb) -> usize {
        let mut pen = x;
        for ch in s.chars() {
            let rows = font::glyph(ch.to_ascii_uppercase());
            for (r, row) in rows.iter().enumerate() {
                for (k, cell) in row.chars().enumerate() {
                    if cell == '#' {
                        self.rect(
                            pen + k * scale,
                            y + r * scale,
                            pen + (k + 1) * scale,
                            y + (r + 1) * scale,
                            c,
                        );
                    }
                }
            }
            pen += 6 * scale;
        }
        pen
    }

    pub fn encode_png(&self) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, self.w as u32, self.h as u32);
            enc.set_color(png::ColorType::Rgb);
            enc.set_depth(png::BitDepth::Eight);
            enc.write_header()
                .expect("png header")
                .write_image_data(&self.px)
                .expect("png data");
        }
        out
    }

    pub fn save(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("create output folder");
        }
        std::fs::write(path, self.encode_png()).expect("write png");
        println!("wrote {}", path.display());
    }
}

pub fn lerp3(a: [f64; 3], b: [f64; 3], t: f64) -> [f64; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

pub fn ramp(stops: &[(f64, [f64; 3])], t: f64) -> [f64; 3] {
    if t <= stops[0].0 {
        return stops[0].1;
    }
    for w in stops.windows(2) {
        if t <= w[1].0 {
            return lerp3(w[0].1, w[1].1, (t - w[0].0) / (w[1].0 - w[0].0));
        }
    }
    stops[stops.len() - 1].1
}

pub fn to_rgb(c: [f64; 3]) -> Rgb {
    [
        (c[0] * 255.0).round().clamp(0.0, 255.0) as u8,
        (c[1] * 255.0).round().clamp(0.0, 255.0) as u8,
        (c[2] * 255.0).round().clamp(0.0, 255.0) as u8,
    ]
}

/// Lambert shade of a `w x d` heightmap from the north-west, 45 degrees
/// up, with the relief exaggerated `ex` times.
pub fn shade(h: &[f64], w: usize, d: usize, stride: f64, ex: f64) -> Vec<f64> {
    let l = {
        let v = [-1.0f64, 1.4, -1.0];
        let m = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        [v[0] / m, v[1] / m, v[2] / m]
    };
    let mut out = vec![1.0; w * d];
    for z in 0..d {
        for x in 0..w {
            let at = |x: usize, z: usize| h[z * w + x];
            let (x0, x1) = (x.saturating_sub(1), (x + 1).min(w - 1));
            let (z0, z1) = (z.saturating_sub(1), (z + 1).min(d - 1));
            let gx = ex * (at(x1, z) - at(x0, z)) / ((x1 - x0).max(1) as f64 * stride);
            let gz = ex * (at(x, z1) - at(x, z0)) / ((z1 - z0).max(1) as f64 * stride);
            let nrm = [-gx, 1.0, -gz];
            let m = (nrm[0] * nrm[0] + 1.0 + nrm[2] * nrm[2]).sqrt();
            let dd = (nrm[0] * l[0] + nrm[1] * l[1] + nrm[2] * l[2]) / m;
            out[z * w + x] = 0.30 + 0.70 * dd.max(0.0);
        }
    }
    out
}

pub const LABEL: &str = "OFFLINE LANDSCAPE RENDER - NOT IN-GAME";
pub const STRIP: usize = 64;

/// The offline label strip and a scale bar.
pub fn label(c: &mut Canvas, line2: &str, size_blocks: usize) {
    c.rect(0, 0, c.w, STRIP, [24, 24, 28]);
    c.text(12, 10, 3, LABEL, [255, 214, 92]);
    c.text(12, 40, 2, line2, [220, 220, 225]);
    let px_per_block = c.w as f64 / size_blocks as f64;
    let blocks = if 1000.0 * px_per_block > c.w as f64 / 3.0 {
        if 100.0 * px_per_block > c.w as f64 / 3.0 {
            10
        } else {
            100
        }
    } else {
        1000
    };
    let bar = (blocks as f64 * px_per_block) as usize;
    if bar > 10 {
        let (x0, y1) = (16, c.h - 14);
        let label_w = 12 * format!("{blocks} BLOCKS").len();
        c.rect(
            x0 - 6,
            y1 - 30,
            x0 + bar.max(label_w) + 6,
            y1 + 8,
            [24, 24, 28],
        );
        c.rect(x0, y1 - 4, x0 + bar, y1 + 2, [240, 240, 240]);
        c.text(x0, y1 - 24, 2, &format!("{blocks} BLOCKS"), [240, 240, 240]);
    }
}

/// The hillshade colour of ground `g`.
pub fn hill_color(g: f64, sea: f64, relief: f64, shade: f64) -> Rgb {
    let base = if g < sea - 0.5 {
        let d = ((sea - g) / 40.0).min(1.0);
        lerp3([0.42, 0.66, 0.78], [0.10, 0.22, 0.42], d)
    } else {
        let s = (g - sea) / relief;
        ramp(
            &[
                (0.0, [0.86, 0.82, 0.60]),
                (0.015, [0.46, 0.64, 0.36]),
                (0.12, [0.36, 0.55, 0.30]),
                (0.22, [0.52, 0.52, 0.34]),
                (0.32, [0.55, 0.47, 0.40]),
                (0.42, [0.62, 0.60, 0.60]),
                (0.55, [0.95, 0.95, 0.97]),
            ],
            s,
        )
    };
    let k = if g < sea - 0.5 {
        0.6 + 0.4 * shade
    } else {
        shade
    };
    to_rgb([base[0] * k, base[1] * k, base[2] * k])
}

/// A distinct colour per node (by its position in the composition order).
pub fn node_color(i: usize) -> [f64; 3] {
    const C: [[f64; 3]; 6] = [
        [0.95, 0.35, 0.25],
        [0.25, 0.55, 0.95],
        [0.30, 0.85, 0.40],
        [0.95, 0.80, 0.20],
        [0.75, 0.40, 0.90],
        [0.20, 0.85, 0.85],
    ];
    C[i % C.len()]
}

/// A claim bit's colour.
pub fn claim_color(bit: u8) -> [f64; 3] {
    match bit {
        0 => [0.95, 0.55, 0.15],
        1 => [0.20, 0.55, 1.00],
        2 => [0.60, 0.60, 0.60],
        3 => [0.90, 0.90, 0.30],
        4 => [0.95, 0.25, 0.75],
        5 => [0.30, 0.85, 0.35],
        _ => [0.85, 0.85, 0.85],
    }
}

/// A map layer of `land` over `n x n` samples from `(x0, z0)` at `stride`:
/// `hillshade`, `edges` (each node's engine edge over a grey hillshade) or
/// `claims` (claim weights over a grey hillshade). Returns the canvas and
/// a legend, without the label strip.
pub fn map_layer(
    land: &Landscape,
    layer: &str,
    x0: i32,
    z0: i32,
    n: usize,
    stride: i32,
) -> Result<(Canvas, Vec<(String, Rgb)>), String> {
    let frame = *land.frame();
    let sea = frame.sea as f64;
    let heights = land.ground_window(x0, z0, n, n, stride);
    let sh = shade(&heights, n, n, stride as f64, 1.6);
    let mut c = Canvas::new(n, n + STRIP, [0, 0, 0]);
    let mut legend = Vec::new();
    match layer {
        "hillshade" => {
            for z in 0..n {
                for x in 0..n {
                    let k = z * n + x;
                    c.set(
                        x,
                        STRIP + z,
                        hill_color(heights[k], sea, frame.relief, sh[k]),
                    );
                }
            }
        }
        "edges" => {
            let nodes = land.dag().order.clone();
            for (i, id) in nodes.iter().enumerate() {
                legend.push((format!("{id} EDGE"), to_rgb(node_color(i))));
            }
            for z in 0..n {
                for x in 0..n {
                    let k = z * n + x;
                    let (wx, wz) = (x0 + x as i32 * stride, z0 + z as i32 * stride);
                    let g = 0.25 + 0.55 * sh[k];
                    let mut rgb = [g, g, g];
                    for (i, id) in nodes.iter().enumerate() {
                        let e = land.node_edge_at(id, wx, wz);
                        if e > 0.0 {
                            rgb = lerp3(rgb, node_color(i), 0.85 * e);
                        }
                    }
                    c.set(x, STRIP + z, to_rgb(rgb));
                }
            }
        }
        "claims" => {
            let cols = land.columns_window(x0, z0, n, n, stride);
            let mut bits: Vec<u8> = Vec::new();
            for z in 0..n {
                for x in 0..n {
                    let k = z * n + x;
                    let g = 0.25 + 0.55 * sh[k];
                    let mut rgb = [g, g, g];
                    for e in &cols[k].claims {
                        if !bits.contains(&e.bit) {
                            bits.push(e.bit);
                        }
                        rgb = lerp3(rgb, claim_color(e.bit), 0.85 * e.weight as f64);
                    }
                    c.set(x, STRIP + z, to_rgb(rgb));
                }
            }
            bits.sort_unstable();
            for b in bits {
                legend.push((
                    format!("{} WEIGHT", voxelize_gen::landscape::Claims::bit_name(b)),
                    to_rgb(claim_color(b)),
                ));
            }
        }
        other => return Err(format!("unknown layer {other} (hillshade, edges, claims)")),
    }
    Ok((c, legend))
}

/// Draw a legend card at the top left of the map.
pub fn legend(c: &mut Canvas, rows: &[(String, Rgb)]) {
    if rows.is_empty() {
        return;
    }
    let width = 32 + 12 * rows.iter().map(|r| r.0.len()).max().unwrap_or(0) + 10;
    c.rect(
        4,
        STRIP + 4,
        4 + width,
        STRIP + 10 + 20 * rows.len(),
        [24, 24, 28],
    );
    let mut y = STRIP + 10;
    for (name, rgb) in rows {
        c.rect(10, y, 26, y + 14, *rgb);
        c.text(32, y + 1, 2, name, [235, 235, 235]);
        y += 20;
    }
}
