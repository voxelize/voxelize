//! Portal geometry: lighting a riftstone frame, the frame a rift needs to
//! stay, finding a portal near an arrival point and building one when
//! there is none. Pure functions over a voxel lookup, so they are tested
//! without an engine.

use platform_content::Content;
use voxelize::BlockUtils;

/// Largest portal interior in either direction.
pub const MAX_SPAN: i32 = 21;
/// Smallest interior: two wide, three tall.
pub const MIN_WIDTH: i32 = 2;
pub const MIN_HEIGHT: i32 = 3;
/// How far from an arrival point an existing portal is reused.
pub const SEARCH_RADIUS: i32 = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PortalBlocks {
    pub rift: u32,
    pub frame: u32,
}

impl PortalBlocks {
    pub fn from_content(content: &Content) -> Option<Self> {
        Some(Self {
            rift: content.block("rift")?.id,
            frame: content.block("riftstone")?.id,
        })
    }
}

/// The in-plane horizontal direction of a portal on `axis` (0: x, 1: z).
fn along(axis: u32) -> [i32; 3] {
    if axis == 0 {
        [1, 0, 0]
    } else {
        [0, 0, 1]
    }
}

fn add(a: [i32; 3], b: [i32; 3], k: i32) -> [i32; 3] {
    [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
}

/// Raw voxel of a rift cell in a portal on `axis`.
pub fn rift_raw(blocks: &PortalBlocks, axis: u32) -> u32 {
    BlockUtils::insert_stage(blocks.rift, axis & 1)
}

/// The canonical cell of the portal containing the rift at `cell`: its
/// lowest, then most negative, rift cell. Both ends of a link are stored
/// by this cell.
pub fn anchor(blocks: &PortalBlocks, cell: [i32; 3], raw_at: impl Fn([i32; 3]) -> u32) -> [i32; 3] {
    let is_rift = |p: [i32; 3]| BlockUtils::extract_id(raw_at(p)) == blocks.rift;
    let side = along(BlockUtils::extract_stage(raw_at(cell)) & 1);
    let mut p = cell;
    for _ in 0..MAX_SPAN * 4 {
        let down = add(p, [0, -1, 0], 1);
        let back = add(p, side, -1);
        if is_rift(down) {
            p = down;
        } else if is_rift(back) {
            p = back;
        } else {
            break;
        }
    }
    p
}

/// Whether a rift cell is still framed: its four in-plane neighbours are
/// rift or riftstone.
pub fn rift_intact(
    blocks: &PortalBlocks,
    raw: u32,
    at: [i32; 3],
    id_at: impl Fn([i32; 3]) -> u32,
) -> bool {
    let axis = BlockUtils::extract_stage(raw) & 1;
    let side = along(axis);
    [side, [-side[0], 0, -side[2]], [0, 1, 0], [0, -1, 0]]
        .into_iter()
        .all(|d| {
            let n = id_at(add(at, d, 1));
            n == blocks.rift || n == blocks.frame
        })
}

/// The cells a fire striker used on the riftstone at `clicked` fills with
/// rift, and the portal's axis — or `None` when it closes no valid frame.
/// `id_at` returns `None` for unloaded voxels.
pub fn ignite(
    blocks: &PortalBlocks,
    clicked: [i32; 3],
    id_at: impl Fn([i32; 3]) -> Option<u32>,
) -> Option<(Vec<[i32; 3]>, u32)> {
    if id_at(clicked)? != blocks.frame {
        return None;
    }
    for axis in [0u32, 1] {
        let side = along(axis);
        for d in [[0, 1, 0], side, [-side[0], 0, -side[2]], [0, -1, 0]] {
            let start = add(clicked, d, 1);
            if id_at(start) != Some(0) {
                continue;
            }
            if let Some(cells) = fill(blocks, start, axis, &id_at) {
                return Some((cells, axis));
            }
        }
    }
    None
}

/// Flood-fill air in the portal plane from `start`; valid when bounded by
/// riftstone on every side and at least `MIN_WIDTH x MIN_HEIGHT` across.
fn fill(
    blocks: &PortalBlocks,
    start: [i32; 3],
    axis: u32,
    id_at: &impl Fn([i32; 3]) -> Option<u32>,
) -> Option<Vec<[i32; 3]>> {
    let side = along(axis);
    let mut seen = vec![start];
    let mut queue = vec![start];
    let h = |p: [i32; 3]| p[0] * side[0] + p[2] * side[2];
    while let Some(p) = queue.pop() {
        for d in [side, [-side[0], 0, -side[2]], [0, 1, 0], [0, -1, 0]] {
            let n = add(p, d, 1);
            if seen.contains(&n) {
                continue;
            }
            match id_at(n)? {
                0 => {
                    if (h(n) - h(start)).abs() >= MAX_SPAN || (n[1] - start[1]).abs() >= MAX_SPAN {
                        return None;
                    }
                    seen.push(n);
                    queue.push(n);
                }
                id if id == blocks.frame => {}
                _ => return None,
            }
        }
    }
    let (min_h, max_h) = seen.iter().fold((i32::MAX, i32::MIN), |(a, b), p| {
        (a.min(h(*p)), b.max(h(*p)))
    });
    let (min_y, max_y) = seen
        .iter()
        .fold((i32::MAX, i32::MIN), |(a, b), p| (a.min(p[1]), b.max(p[1])));
    (max_h - min_h + 1 >= MIN_WIDTH && max_y - min_y + 1 >= MIN_HEIGHT).then_some(seen)
}

/// The lowest rift cell within `SEARCH_RADIUS` columns of `center`,
/// nearest first, scanning heights `y_range`.
pub fn find_rift(
    blocks: &PortalBlocks,
    center: [i32; 3],
    y_range: std::ops::Range<i32>,
    id_at: impl Fn([i32; 3]) -> u32,
) -> Option<[i32; 3]> {
    let mut best: Option<([i32; 3], i64)> = None;
    for dx in -SEARCH_RADIUS..=SEARCH_RADIUS {
        for dz in -SEARCH_RADIUS..=SEARCH_RADIUS {
            for y in y_range.clone() {
                let p = [center[0] + dx, y, center[2] + dz];
                if id_at(p) == blocks.rift && id_at([p[0], y - 1, p[2]]) != blocks.rift {
                    let d = (dx * dx + dz * dz) as i64 + ((y - center[1]) as i64).pow(2);
                    if best.is_none_or(|(_, b)| d < b) {
                        best = Some((p, d));
                    }
                }
            }
        }
    }
    best.map(|(p, _)| p)
}

/// A new portal standing on a floor at `floor_y` (the frame's bottom row),
/// its lower-left interior corner at `origin`'s column: frame, rift and a
/// riftstone ledge on both sides with headroom cleared, so the traveller
/// arrives on solid ground in open air. Returns writes and the lower
/// interior cell to stand in.
pub fn build(
    blocks: &PortalBlocks,
    x: i32,
    floor_y: i32,
    z: i32,
) -> (Vec<([i32; 3], u32)>, [i32; 3]) {
    let mut writes = Vec::new();
    let rift = rift_raw(blocks, 0);
    // Outer frame 4 wide (x .. x+3) and 5 tall (floor_y .. floor_y+4) at z.
    for dx in 0..4 {
        for dy in 0..5 {
            let edge = dx == 0 || dx == 3 || dy == 0 || dy == 4;
            writes.push((
                [x + dx, floor_y + dy, z],
                if edge { blocks.frame } else { rift },
            ));
        }
    }
    // Ledges and headroom in front of and behind the portal.
    for dz in [-1, 1] {
        for dx in 0..4 {
            writes.push(([x + dx, floor_y, z + dz], blocks.frame));
            for dy in 1..4 {
                writes.push(([x + dx, floor_y + dy, z + dz], 0));
            }
        }
    }
    (writes, [x + 1, floor_y + 1, z])
}

/// Where to build a portal near `center`: a floor (solid with three air
/// cells above) within 8 columns and the given heights, nearest first;
/// falls back to `center` itself (the build clears the space).
pub fn site(
    center: [i32; 3],
    y_range: std::ops::Range<i32>,
    solid: impl Fn([i32; 3]) -> bool,
) -> [i32; 3] {
    let mut best: Option<([i32; 3], i64)> = None;
    for dx in -8..=8 {
        for dz in -8..=8 {
            for y in y_range.clone() {
                let (x, z) = (center[0] + dx, center[2] + dz);
                let fits = (0..4).all(|i| {
                    (-1..=1).all(|k| {
                        solid([x + i, y, z + k]) && (1..5).all(|h| !solid([x + i, y + h, z + k]))
                    })
                });
                if fits {
                    let d = (dx * dx + dz * dz) as i64 + ((y - center[1]) as i64).pow(2);
                    if best.is_none_or(|(_, b)| d < b) {
                        best = Some(([x, y, z], d));
                    }
                }
            }
        }
    }
    best.map(|(p, _)| p).unwrap_or(center)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const B: PortalBlocks = PortalBlocks {
        rift: 54,
        frame: 53,
    };
    const STONE: u32 = 2;

    fn frame_x(world: &mut HashMap<[i32; 3], u32>, x: i32, y: i32, z: i32, w: i32, h: i32) {
        for dx in 0..w + 2 {
            for dy in 0..h + 2 {
                if dx == 0 || dx == w + 1 || dy == 0 || dy == h + 1 {
                    world.insert([x + dx, y + dy, z], B.frame);
                }
            }
        }
    }

    fn lookup(world: &HashMap<[i32; 3], u32>) -> impl Fn([i32; 3]) -> Option<u32> + '_ {
        move |p| Some(*world.get(&p).unwrap_or(&0))
    }

    #[test]
    fn a_closed_frame_lights_and_an_open_one_does_not() {
        let mut w = HashMap::new();
        frame_x(&mut w, 0, 10, 0, 2, 3);
        let (cells, axis) = ignite(&B, [1, 10, 0], lookup(&w)).expect("lights");
        assert_eq!(axis, 0);
        assert_eq!(cells.len(), 6);
        // Clicking a side of the frame works too.
        assert!(ignite(&B, [0, 12, 0], lookup(&w)).is_some());

        // A gap in the frame: the fill escapes and nothing lights.
        w.remove(&[3, 12, 0]);
        assert_eq!(ignite(&B, [1, 10, 0], lookup(&w)), None);

        // Too small (1 wide).
        let mut small = HashMap::new();
        frame_x(&mut small, 0, 10, 0, 1, 3);
        assert_eq!(ignite(&B, [1, 10, 0], lookup(&small)), None);

        // A frame in the z plane.
        let mut zw = HashMap::new();
        for dz in 0..4 {
            for dy in 0..5 {
                if dz == 0 || dz == 3 || dy == 0 || dy == 4 {
                    zw.insert([5, 20 + dy, dz], B.frame);
                }
            }
        }
        let (cells, axis) = ignite(&B, [5, 20, 1], lookup(&zw)).expect("z portal");
        assert_eq!((cells.len(), axis), (6, 1));

        // Unloaded neighbours never light.
        assert_eq!(ignite(&B, [1, 10, 0], |_| None), None);
        // Something other than air inside blocks it.
        let mut blocked = HashMap::new();
        frame_x(&mut blocked, 0, 10, 0, 2, 3);
        blocked.insert([2, 12, 0], STONE);
        assert_eq!(ignite(&B, [1, 10, 0], lookup(&blocked)), None);
    }

    #[test]
    fn rifts_need_their_frame() {
        let (writes, stand) = build(&B, 0, 10, 0);
        let mut w: HashMap<[i32; 3], u32> = writes.into_iter().collect();
        let id = |w: &HashMap<[i32; 3], u32>| {
            let w = w.clone();
            move |p: [i32; 3]| BlockUtils::extract_id(*w.get(&p).unwrap_or(&0))
        };
        let raw = w[&stand];
        assert_eq!(BlockUtils::extract_id(raw), B.rift);
        assert!(rift_intact(&B, raw, stand, id(&w)));
        w.insert([0, 11, 0], 0); // break the frame beside it
        assert!(!rift_intact(&B, raw, stand, id(&w)));
        // A neighbouring rift still has its frame and rift neighbours.
        assert!(rift_intact(&B, raw, [2, 12, 0], id(&w)));
    }

    #[test]
    fn every_cell_of_a_portal_has_the_same_anchor() {
        let (writes, stand) = build(&B, 4, 10, -3);
        let w: HashMap<[i32; 3], u32> = writes.into_iter().collect();
        let raw = |p: [i32; 3]| *w.get(&p).unwrap_or(&0);
        let cells: Vec<[i32; 3]> = w
            .iter()
            .filter(|(_, v)| BlockUtils::extract_id(**v) == B.rift)
            .map(|(p, _)| *p)
            .collect();
        assert_eq!(cells.len(), 6);
        for c in cells {
            assert_eq!(anchor(&B, c, raw), stand);
        }
    }

    #[test]
    fn arrivals_reuse_nearby_portals_and_build_on_open_floor() {
        let (writes, _) = build(&B, 10, 40, 5);
        let w: HashMap<[i32; 3], u32> = writes
            .into_iter()
            .map(|(p, v)| (p, BlockUtils::extract_id(v)))
            .collect();
        let found = find_rift(&B, [3, 50, 3], 1..120, |p| *w.get(&p).unwrap_or(&0));
        assert_eq!(found, Some([11, 41, 5]), "lowest rift cell, nearest column");
        assert_eq!(
            find_rift(&B, [60, 50, 60], 1..120, |p| *w.get(&p).unwrap_or(&0)),
            None
        );

        // Flat ground at y = 30: a site on it near the centre.
        let s = site([0, 35, 0], 1..100, |p| p[1] <= 30);
        assert_eq!(s[1], 30);
        assert!(s[0].abs() <= 8 && s[2].abs() <= 8);
        // Solid everywhere: fall back to the centre.
        assert_eq!(site([0, 35, 0], 1..100, |_| true), [0, 35, 0]);
    }
}
