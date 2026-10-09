//! Branches: voxels drawn as square-section tubes whose thickness each voxel
//! holds in its stage. A branch voxel draws a core `radius` texels from its
//! axis on every side and an arm out to every face neighbour it joins, at the
//! thinner of the two radii, so a run of voxels with falling radii tapers.
//! Face neighbours that are branches of the same key always join; a block
//! declaring a [`BranchSocket`] for the key takes branches up to a radius
//! (a twig running into a leaf, a trunk into the soil it stands in).
//!
//! A shape is seated through the middle of its voxel ([`BranchSeat::Centre`],
//! a limb in the air) or along its floor ([`BranchSeat::Floor`], a surface
//! root half sunk into the ground: only the half above the floor exists).
//! Where a centred branch meets a floor-seated one beside it, the joint lies
//! along the floor too, so a trunk flares into its roots.
//!
//! Everything is laid out in whole texels of `texels_per_block`, and every
//! face samples its texture at that density: sides sample the side texture
//! at their own position with its rows running along the part's axis, and an
//! exposed end samples the end texture around the part's own axis. A
//! two-texel twig shows a two-texel strip of bark and the middle 2x2 of the
//! rings, never the whole tile squeezed onto it.
//!
//! The layout ([`BranchLayout`]) is shared: the mesher draws its parts here
//! and both servers and clients collide and pick against [`BranchLayout::aabbs`].

use serde::{Deserialize, Serialize};
use voxelize_core::{BlockFace, BlockUtils, CornerData, VoxelAccess, AABB};

use super::*;

/// Where a branch's axis runs through its voxel.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BranchSeat {
    /// Through the middle of the voxel: a limb in the air.
    #[default]
    Centre,
    /// Along the middle of the voxel's floor, half sunk into what lies below
    /// it: a surface root. Only the half above the floor is drawn or collides.
    Floor,
}

/// What a branch block's voxels are, beyond their joints.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BranchKind {
    /// One voxel thick, with its radius in the stage's radius bits.
    #[default]
    Voxel,
    /// The core cell of a section wider than one voxel ([`WideBranchSection`]).
    /// Its radius and cut flag live in [`WideBranchBits`]; the section's
    /// other cells are shells ([`Block::branch_shell`]) pointing at it.
    Core,
    /// A floor-seated fin: as thick as its radius bits say and as tall as its
    /// height in [`WideBranchBits`], up to the voxel's top.
    Fin,
}

/// Draws a block as a branch. Declared on the block, read by the mesher and
/// by every collision and picking query.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchShape {
    /// Branches sharing a key join, and so do blocks with a socket for it.
    /// Every shape sharing a key must share `texels_per_block`.
    pub key: u32,
    #[serde(default)]
    pub seat: BranchSeat,
    #[serde(default)]
    pub kind: BranchKind,
    /// Texels per block the faces are drawn at, and radii are counted in.
    pub texels_per_block: u32,
    /// The contiguous run of stage bits holding the radius less one.
    pub radius_mask: u32,
    /// The face whose texture dresses the sides (bark).
    pub side_face: String,
    /// The face whose texture dresses an exposed end (rings): a tip, both
    /// ends of a lone voxel, an arm ending inside a see-through socket.
    pub end_face: String,
}

/// A block that branches of `key` run into without being branches: a leaf
/// a twig grows into, the soil a trunk stands in.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchSocket {
    pub key: u32,
    /// The thickest branch this block takes, in that branch's texels. A
    /// thicker one passes it by without joining.
    pub max_radius: u32,
}

/// What lies across one face of a branch voxel, as the branch sees it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BranchSide {
    /// Nothing the branch joins.
    #[default]
    Apart,
    /// A branch of the same key. A wide section's cell reads as a centred
    /// branch of the section's radius.
    Branch { radius: u32, seat: BranchSeat },
    /// A fin of the same key, `height` texels tall.
    Fin { radius: u32, height: u32 },
    /// A block that takes this key's branches up to `max_radius`.
    Socket { max_radius: u32 },
    /// Another drawn cell of the same wide section: the tube carries on.
    Section,
}

/// The state wide branch voxels keep in raw bits 16-23, which their blocks
/// declare as state rather than a rotation.
pub struct WideBranchBits;

impl WideBranchBits {
    const SHIFT: u32 = 16;
    const SIZE_MASK: u32 = 0x3F;
    const OFFSET_MASK: u32 = 0xF;
    const OFFSET_BIAS: i32 = 8;
    const CUT_STAGE_BIT: u32 = 1;

    /// A core's radius, or a fin's height, in texels (1-64): bits 16-21.
    pub fn size(raw: u32) -> u32 {
        ((raw >> Self::SHIFT) & Self::SIZE_MASK) + 1
    }

    pub fn with_size(raw: u32, size: u32) -> u32 {
        let size = size.clamp(1, Self::SIZE_MASK + 1);
        (raw & !(Self::SIZE_MASK << Self::SHIFT)) | ((size - 1) << Self::SHIFT)
    }

    /// Stage bit 0 of a core: its own slice is cut away, but it still lends
    /// its radius to its shells.
    pub fn is_cut(raw: u32) -> bool {
        BlockUtils::extract_stage(raw) & Self::CUT_STAGE_BIT != 0
    }

    pub fn with_cut(raw: u32, cut: bool) -> u32 {
        let stage = BlockUtils::extract_stage(raw);
        let stage = if cut {
            stage | Self::CUT_STAGE_BIT
        } else {
            stage & !Self::CUT_STAGE_BIT
        };
        BlockUtils::insert_stage(raw, stage)
    }

    /// A shell's offset to its core, `(dx, dz)`, each -8..7: bits 16-19 and
    /// 20-23. The core stands at the shell's position plus this offset.
    pub fn shell_offset(raw: u32) -> (i32, i32) {
        let field = |shift: u32| ((raw >> shift) & Self::OFFSET_MASK) as i32 - Self::OFFSET_BIAS;
        (field(Self::SHIFT), field(Self::SHIFT + 4))
    }

    pub fn with_shell_offset(raw: u32, dx: i32, dz: i32) -> u32 {
        assert!(
            (-8..8).contains(&dx) && (-8..8).contains(&dz),
            "a shell reaches its core within -8..7, got ({dx}, {dz})"
        );
        let field = (((dz + Self::OFFSET_BIAS) as u32) << 4) | (dx + Self::OFFSET_BIAS) as u32;
        (raw & !(0xFF << Self::SHIFT)) | (field << Self::SHIFT)
    }
}

impl BranchShape {
    /// The thickest radius a voxel can hold: half a block.
    pub fn max_radius(&self) -> u32 {
        (self.texels_per_block / 2).max(1)
    }

    fn radius_shift(&self) -> u32 {
        self.radius_mask.trailing_zeros().min(31)
    }

    /// The radius a voxel of this shape holds at `stage`, in texels.
    pub fn radius(&self, stage: u32) -> u32 {
        (((stage & self.radius_mask) >> self.radius_shift()) + 1).min(self.max_radius())
    }

    /// `stage` with its radius bits set to hold `radius`, every other bit kept.
    pub fn with_radius(&self, stage: u32, radius: u32) -> u32 {
        let radius = radius.clamp(1, self.max_radius());
        (stage & !self.radius_mask) | (((radius - 1) << self.radius_shift()) & self.radius_mask)
    }

    /// How a voxel of this shape sees a neighbour that is a one-voxel branch
    /// or fin (`branch`) holding `raw`, or a block with `sockets`.
    pub fn side(
        &self,
        branch: Option<&BranchShape>,
        sockets: &[BranchSocket],
        raw: u32,
    ) -> BranchSide {
        if let Some(other) = branch.filter(|other| other.key == self.key) {
            let radius = other.radius(BlockUtils::extract_stage(raw));
            return match other.kind {
                BranchKind::Fin => BranchSide::Fin {
                    radius,
                    height: other.fin_height(raw),
                },
                _ => BranchSide::Branch {
                    radius,
                    seat: other.seat,
                },
            };
        }
        sockets
            .iter()
            .find(|socket| socket.key == self.key)
            .map_or(BranchSide::Apart, |socket| BranchSide::Socket {
                max_radius: socket.max_radius,
            })
    }

    /// How tall a fin of this shape holding `raw` stands, in texels, up to
    /// its voxel's top.
    pub fn fin_height(&self, raw: u32) -> u32 {
        WideBranchBits::size(raw).min(self.texels_per_block)
    }
}

/// The face directions in [`VOXEL_NEIGHBORS`] order: +x, -x, +y, -y, +z, -z.
const SIDES: usize = 6;

const fn side_axis(side: usize) -> usize {
    side / 2
}

const fn side_is_positive(side: usize) -> bool {
    side % 2 == 0
}

/// What a part of a branch voxel is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BranchPartKind {
    Core,
    /// The arm toward the side at this index of [`VOXEL_NEIGHBORS`].
    Arm(usize),
}

/// One box of a branch voxel, in texels of its voxel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BranchPart {
    pub kind: BranchPartKind,
    pub min: [i32; 3],
    pub max: [i32; 3],
    /// The axis its grain runs along.
    pub axis: usize,
    /// A point on its axis: where an exposed end centres the rings.
    pub centre: [i32; 3],
}

/// How one branch voxel is put together: its radius, what each side joins
/// and the boxes it is made of. Every box lies inside the voxel, and no two
/// overlap; they only touch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BranchLayout {
    pub texels_per_block: i32,
    pub radius: u32,
    pub seat: BranchSeat,
    pub sides: [BranchSide; SIDES],
    /// The radius of the joint toward each side, 0 where it does not join.
    pub joints: [u32; SIDES],
    /// How tall each joint laid along the floor stands, 0 for the others.
    pub joint_heights: [u32; SIDES],
    /// The axis the core's grain runs along.
    pub axis: usize,
    pub parts: Vec<BranchPart>,
    /// The cell of a wide section this voxel is, if it is one.
    pub wide: Option<WideCell>,
}

/// A cell of a wide section, as its layout needs it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WideCell {
    pub section: WideBranchSection,
    /// Cells from the core, on x and z.
    pub offset: [i32; 2],
    /// This is the core, with its own slice cut away.
    pub cut: bool,
    /// Whether the trunk carries on below and above this level: a face
    /// there is the bark of a ledge, not the rings of an end.
    pub carries_on: [bool; 2],
    /// Whether the cell below and above draws a slice covering this one's.
    pub covered: [bool; 2],
}

/// The joint a branch of `radius` makes with what lies on one side.
fn joint_radius(radius: u32, side: BranchSide) -> u32 {
    match side {
        BranchSide::Apart => 0,
        BranchSide::Branch { radius: other, .. } | BranchSide::Fin { radius: other, .. } => {
            radius.min(other)
        }
        BranchSide::Socket { max_radius } => {
            if radius <= max_radius {
                radius
            } else {
                0
            }
        }
        BranchSide::Section => radius,
    }
}

/// Whether a horizontal joint toward `side` lies along the floor: when the
/// neighbour does (a root, a fin) or this voxel does.
fn lies_along_floor(own_seat: BranchSeat, sides: &[BranchSide; SIDES], side: usize) -> bool {
    side_axis(side) != 1
        && (own_seat == BranchSeat::Floor
            || matches!(
                sides[side],
                BranchSide::Branch {
                    seat: BranchSeat::Floor,
                    ..
                } | BranchSide::Fin { .. }
            ))
}

impl BranchLayout {
    /// Lay out a one-voxel branch of `shape` at `stage` whose neighbours are
    /// `sides`.
    pub fn new(shape: &BranchShape, stage: u32, sides: [BranchSide; SIDES]) -> Self {
        let radius = shape.radius(stage);
        Self::laid(shape, radius, None, sides)
    }

    /// Lay out a fin of `shape` at `stage`, `height` texels tall.
    pub fn fin(shape: &BranchShape, stage: u32, height: u32, sides: [BranchSide; SIDES]) -> Self {
        let radius = shape.radius(stage);
        Self::laid(
            shape,
            radius,
            Some(height.clamp(1, shape.texels_per_block)),
            sides,
        )
    }

    fn laid(
        shape: &BranchShape,
        radius: u32,
        fin_height: Option<u32>,
        sides: [BranchSide; SIDES],
    ) -> Self {
        let t = shape.texels_per_block as i32;
        let c = t / 2;
        let r = radius as i32;
        let seat = shape.seat;
        let joints = sides.map(|side| joint_radius(radius, side));

        // A horizontal joint lies along the floor when either end of it
        // does; a vertical one always runs up the middle.
        let floor_joint = |side: usize| lies_along_floor(seat, &sides, side);
        // A floor joint is as tall as its thinner end, except that a fin
        // meets its neighbour at the lower of the two heights.
        let floor_height = |side: usize| match sides[side] {
            BranchSide::Fin { height, .. } => height,
            BranchSide::Branch {
                seat: BranchSeat::Floor,
                radius,
            } => radius,
            _ => t as u32,
        };
        let own_floor = match (seat, fin_height) {
            (_, Some(height)) => height,
            (BranchSeat::Floor, None) => radius,
            (BranchSeat::Centre, None) => t as u32,
        };
        let joint_heights: [u32; SIDES] = std::array::from_fn(|side| {
            if !floor_joint(side) {
                0
            } else if fin_height.is_some() || matches!(sides[side], BranchSide::Fin { .. }) {
                own_floor.min(floor_height(side)).min(t as u32)
            } else {
                joints[side]
            }
        });

        // The core's grain follows its thickest joint, then the axis with
        // more joints, then vertical before x before z. A root lies along
        // the floor, so its grain is never vertical.
        let candidates: &[usize] = match seat {
            BranchSeat::Centre => &[1, 0, 2],
            BranchSeat::Floor => &[0, 2],
        };
        let mut axis = candidates[0];
        let mut best = (0, 0);
        for &candidate in candidates {
            let (a, b) = (joints[candidate * 2], joints[candidate * 2 + 1]);
            let score = (a.max(b), u32::from(a > 0) + u32::from(b > 0));
            if score > best {
                best = score;
                axis = candidate;
            }
        }

        let (low_y, high_y) = match seat {
            BranchSeat::Centre => (c - r, c + r),
            BranchSeat::Floor => (0, own_floor as i32),
        };
        let mut core_min = [c - r, low_y, c - r];
        let mut core_max = [c + r, high_y, c + r];
        let core_centre = [c, if seat == BranchSeat::Floor { 0 } else { c }, c];
        // A joint along the core's axis as thick as the core, and laid the
        // same way, is the core carried on to the voxel's face.
        let absorbs = |side: usize| {
            joints[side] == radius && floor_joint(side) == (seat == BranchSeat::Floor && axis != 1)
        };
        if absorbs(axis * 2) {
            core_max[axis] = t;
        }
        if absorbs(axis * 2 + 1) {
            core_min[axis] = 0;
        }

        let mut parts = vec![BranchPart {
            kind: BranchPartKind::Core,
            min: core_min,
            max: core_max,
            axis,
            centre: core_centre,
        }];

        for side in 0..SIDES {
            let j = joints[side] as i32;
            if j == 0 {
                continue;
            }
            let along = side_axis(side);
            let (start, end) = if side_is_positive(side) {
                (core_max[along], t)
            } else {
                (0, core_min[along])
            };
            if start >= end {
                continue;
            }
            parts.push(arm(
                side,
                j,
                start,
                end,
                floor_joint(side),
                joint_heights[side],
                c,
            ));
        }

        Self {
            texels_per_block: t,
            radius,
            seat,
            sides,
            joints,
            joint_heights,
            axis,
            parts,
            wide: None,
        }
    }

    /// Lay out a cell of a wide section: its slice of the section's tube,
    /// the whole height of the voxel, and an arm from the tube's surface out
    /// to each one-voxel branch or fin it joins beside it. A cut core lays
    /// out nothing.
    pub fn wide(shape: &BranchShape, cell: WideCell, sides: [BranchSide; SIDES]) -> Self {
        let t = shape.texels_per_block as i32;
        let c = t / 2;
        let radius = cell.section.radius;
        let joints = sides.map(|side| joint_radius(radius, side));
        let joint_heights: [u32; SIDES] = std::array::from_fn(|side| {
            match (
                lies_along_floor(BranchSeat::Centre, &sides, side),
                sides[side],
            ) {
                (true, BranchSide::Fin { height, .. }) => height.min(t as u32),
                (true, _) => joints[side],
                (false, _) => 0,
            }
        });

        let mut parts = Vec::new();
        let spans = (
            cell.section.span(cell.offset[0]),
            cell.section.span(cell.offset[1]),
        );
        if let (false, Some((x0, x1)), Some((z0, z1))) = (cell.cut, spans.0, spans.1) {
            let slice_min = [x0 as i32, 0, z0 as i32];
            let slice_max = [x1 as i32, t, z1 as i32];
            parts.push(BranchPart {
                kind: BranchPartKind::Core,
                min: slice_min,
                max: slice_max,
                axis: 1,
                centre: [c; 3],
            });
            for side in [0, 1, 4, 5] {
                let j = joints[side] as i32;
                if j == 0 || matches!(sides[side], BranchSide::Section | BranchSide::Socket { .. })
                {
                    continue;
                }
                let along = side_axis(side);
                let (start, end) = if side_is_positive(side) {
                    (slice_max[along], t)
                } else {
                    (0, slice_min[along])
                };
                if start >= end {
                    continue;
                }
                let floor = lies_along_floor(BranchSeat::Centre, &sides, side);
                parts.push(arm(side, j, start, end, floor, joint_heights[side], c));
            }
        }

        Self {
            texels_per_block: t,
            radius,
            seat: BranchSeat::Centre,
            sides,
            joints,
            joint_heights,
            axis: 1,
            parts,
            wide: Some(cell),
        }
    }

    /// The wood this voxel is drawn as, in cubic texels: a full block is
    /// `texels_per_block³` (4096 at 16), a straight run at radius `r` is
    /// `(2r)² × texels_per_block`. Volume, drops and hardness read this, so
    /// what a tree pays out is the wood it showed.
    pub fn volume(&self) -> u32 {
        self.parts
            .iter()
            .map(|part| {
                (0..3)
                    .map(|axis| (part.max[axis] - part.min[axis]).max(0) as u32)
                    .product::<u32>()
            })
            .sum()
    }

    /// The boxes a body collides with and a ray picks, in blocks of the
    /// voxel (add the voxel's position for world space).
    pub fn aabbs(&self) -> Vec<AABB> {
        let t = self.texels_per_block as f32;
        self.parts
            .iter()
            .map(|part| AABB {
                min_x: part.min[0] as f32 / t,
                min_y: part.min[1] as f32 / t,
                min_z: part.min[2] as f32 / t,
                max_x: part.max[0] as f32 / t,
                max_y: part.max[1] as f32 / t,
                max_z: part.max[2] as f32 / t,
            })
            .collect()
    }

    /// The cross-section of the joint toward `side`, on the two axes across
    /// it (ascending), or `None` where it does not join.
    fn joint_rect(&self, side: usize) -> Option<[i32; 4]> {
        let j = self.joints[side] as i32;
        if j == 0 {
            return None;
        }
        let c = self.texels_per_block / 2;
        let floor = lies_along_floor(self.seat, &self.sides, side);
        let [u, v] = cross_axes(side_axis(side));
        let span = |axis: usize| {
            if floor && axis == 1 {
                (0, self.joint_heights[side] as i32)
            } else {
                (c - j, c + j)
            }
        };
        let (u0, u1) = span(u);
        let (v0, v1) = span(v);
        Some([u0, v0, u1, v1])
    }

    /// Whether the core ends at a free tip toward `side`: the far end of a
    /// voxel joined on one side only, or either end of a lone voxel.
    fn is_tip(&self, side: usize) -> bool {
        let joined: Vec<usize> = (0..SIDES).filter(|&s| self.joints[s] > 0).collect();
        match joined[..] {
            [] => side_axis(side) == self.axis,
            [only] => side == (only ^ 1),
            _ => false,
        }
    }

    /// Whether another part presses against the face of part `index`
    /// toward `side`, at `plane` and covering `rect`, from the far side.
    fn covered(&self, index: usize, side: usize, plane: i32, rect: [i32; 4]) -> bool {
        let axis = side_axis(side);
        let positive = side_is_positive(side);
        let [u, v] = cross_axes(axis);
        self.parts.iter().enumerate().any(|(other, box_)| {
            other != index
                && (if positive {
                    box_.min[axis] == plane
                } else {
                    box_.max[axis] == plane
                })
                && box_.min[u] <= rect[0]
                && box_.min[v] <= rect[1]
                && box_.max[u] >= rect[2]
                && box_.max[v] >= rect[3]
        })
    }

    /// Every face this voxel shows, given what lies beyond each of its sides.
    pub fn faces(&self, beyond: &[BranchBeyond; SIDES]) -> Vec<BranchQuad> {
        if let Some(cell) = self.wide {
            return self.wide_faces(cell, beyond);
        }
        let t = self.texels_per_block;
        let mut quads = Vec::new();
        for (index, part) in self.parts.iter().enumerate() {
            for side in 0..SIDES {
                let axis = side_axis(side);
                let positive = side_is_positive(side);
                let plane = if positive {
                    part.max[axis]
                } else {
                    part.min[axis]
                };
                let [u, v] = cross_axes(axis);
                let rect = [part.min[u], part.min[v], part.max[u], part.max[v]];
                if self.covered(index, side, plane, rect) {
                    continue;
                }

                let is_end = axis == part.axis;
                let mut texture = BranchTexture::Side;
                if plane == if positive { t } else { 0 } {
                    let joint = self.joint_rect(side).filter(|joint| {
                        joint[0] <= rect[0]
                            && joint[1] <= rect[1]
                            && joint[2] >= rect[2]
                            && joint[3] >= rect[3]
                    });
                    if joint.is_some() {
                        // The open end of a joint: the neighbour carries the
                        // branch on, unless it is a socket the end shows in.
                        match (self.sides[side], beyond[side]) {
                            (BranchSide::Socket { .. }, BranchBeyond::SeeThrough) => {
                                texture = BranchTexture::End;
                            }
                            _ => continue,
                        }
                    } else if beyond[side] == BranchBeyond::Opaque {
                        continue;
                    }
                }
                if is_end
                    && texture == BranchTexture::Side
                    && part.kind == BranchPartKind::Core
                    && self.is_tip(side)
                {
                    texture = BranchTexture::End;
                }
                quads.push(BranchQuad {
                    side,
                    plane,
                    rect,
                    axis: part.axis,
                    centre: part.centre,
                    texture,
                });
            }
        }
        quads
    }

    /// The faces of a wide section's cell. Its slice shows bark on the
    /// tube's surface. A face on the boundary with the section's next cell
    /// is dropped, and where that cell is gone (felled, or the cut core) the
    /// face shows the cut wood's rings. The top and bottom show the bark of a
    /// ledge, or the rings of the trunk's end where nothing carries it on,
    /// and are dropped where the level beyond covers them. An arm's far end
    /// is open: the branch it joins carries on.
    fn wide_faces(&self, cell: WideCell, beyond: &[BranchBeyond; SIDES]) -> Vec<BranchQuad> {
        let t = self.texels_per_block;
        let mut quads = Vec::new();
        for (index, part) in self.parts.iter().enumerate() {
            for side in 0..SIDES {
                let axis = side_axis(side);
                let positive = side_is_positive(side);
                let plane = if positive {
                    part.max[axis]
                } else {
                    part.min[axis]
                };
                let [u, v] = cross_axes(axis);
                let rect = [part.min[u], part.min[v], part.max[u], part.max[v]];
                if self.covered(index, side, plane, rect) {
                    continue;
                }
                let at_boundary = plane == if positive { t } else { 0 };
                if at_boundary && beyond[side] == BranchBeyond::Opaque {
                    continue;
                }
                let mut texture = BranchTexture::Side;
                if part.kind == BranchPartKind::Core {
                    if axis == 1 {
                        let k = usize::from(positive);
                        if cell.covered[k] {
                            continue;
                        }
                        if !cell.carries_on[k] {
                            texture = BranchTexture::End;
                        }
                    } else if at_boundary {
                        if self.sides[side] == BranchSide::Section {
                            continue;
                        }
                        let step = if positive { 1 } else { -1 };
                        let next = cell.offset[if axis == 0 { 0 } else { 1 }] + step;
                        if cell.section.span(next).is_some() {
                            texture = BranchTexture::End;
                        }
                    }
                } else if at_boundary && axis == part.axis {
                    continue;
                }
                quads.push(BranchQuad {
                    side,
                    plane,
                    rect,
                    axis: part.axis,
                    centre: part.centre,
                    texture,
                });
            }
        }
        quads
    }
}

/// The arm toward `side`, `j` texels from the axis, running from `start` to
/// `end` along the side's axis; laid along the floor and `height` tall for a
/// floor joint.
fn arm(side: usize, j: i32, start: i32, end: i32, floor: bool, height: u32, c: i32) -> BranchPart {
    let along = side_axis(side);
    let mut min = [c - j; 3];
    let mut max = [c + j; 3];
    let mut centre = [c; 3];
    if floor {
        min[1] = 0;
        max[1] = height as i32;
        centre[1] = 0;
    }
    min[along] = start;
    max[along] = end;
    BranchPart {
        kind: BranchPartKind::Arm(side),
        min,
        max,
        axis: along,
        centre,
    }
}

/// A branch section wider than one voxel: one square tube of half-width
/// `radius` texels round the axis through the middle of its core cell, cut
/// into the cells it covers. Each cell draws, collides with and weighs only
/// the tube's overlap with its own square, so a section's cells add up to the
/// whole tube, and a section no wider than half a block is its core cell
/// alone, as wide as a one-voxel branch's core.
///
/// Cells are counted from the core on the two axes across the tube's axis.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WideBranchSection {
    pub radius: u32,
    pub texels_per_block: u32,
}

impl WideBranchSection {
    /// Cells the section reaches on each side of its core.
    pub fn reach(&self) -> i32 {
        let t = self.texels_per_block.max(1);
        ((self.radius + t / 2).saturating_sub(1) / t) as i32
    }

    /// The tube's span across the cell `d` cells from the core along one
    /// axis, in that cell's own texels (within `0..=texels_per_block`), or
    /// `None` where the tube does not reach it.
    pub fn span(&self, d: i32) -> Option<(u32, u32)> {
        let t = i64::from(self.texels_per_block);
        let (centre, radius) = (t / 2, i64::from(self.radius));
        let start = i64::from(d) * t;
        let low = (centre - radius).max(start);
        let high = (centre + radius).min(start + t);
        (high > low).then(|| ((low - start) as u32, (high - start) as u32))
    }

    /// The tube's area inside the cell `(da, db)` from the core, in texel²:
    /// `texels_per_block²` where it fills the cell, 0 past its reach.
    pub fn cell_area(&self, da: i32, db: i32) -> u32 {
        let width = |d: i32| self.span(d).map_or(0, |(low, high)| high - low);
        width(da) * width(db)
    }

    /// The whole tube's section in texel², `(2 × radius)²`: the sum of its
    /// cells' areas.
    pub fn area(&self) -> u32 {
        (2 * self.radius).pow(2)
    }
}

/// What lies beyond one side of a branch voxel, for what its faces there show.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BranchBeyond {
    /// Covers a face on the voxel's boundary completely.
    Opaque,
    /// Shows what is behind it (a leaf): an end inside it stays drawn.
    SeeThrough,
    #[default]
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BranchTexture {
    Side,
    End,
}

/// One rectangle a branch voxel draws, in texels of its voxel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BranchQuad {
    /// Which way it faces, as an index of [`VOXEL_NEIGHBORS`].
    pub side: usize,
    /// Its position along the axis it faces.
    pub plane: i32,
    /// Its extent on the two other axes (ascending): `[u0, v0, u1, v1]`.
    pub rect: [i32; 4],
    /// The grain axis of the part it belongs to.
    pub axis: usize,
    /// A point on that part's axis.
    pub centre: [i32; 3],
    pub texture: BranchTexture,
}

/// The two axes across `axis`, ascending.
const fn cross_axes(axis: usize) -> [usize; 2] {
    match axis {
        0 => [1, 2],
        1 => [0, 2],
        _ => [0, 1],
    }
}

/// The texture coordinate a face toward `side` samples at `pos` (in blocks
/// of the voxel): the voxel turned so `axis` runs vertically, then read the
/// way a cube's six faces read their texture. Along every edge the
/// coordinate moves exactly as far as the position does, so every face keeps
/// one texel density on both of its axes.
fn grain_uv(side: usize, axis: usize, pos: [f32; 3]) -> [f32; 2] {
    let [x, y, z] = pos;
    let dir = VOXEL_NEIGHBORS[side];
    // Proper rotations about the voxel's centre that carry `axis` onto y.
    let (p, d) = match axis {
        0 => ([1.0 - y, x, z], [-dir[1], dir[0], dir[2]]),
        2 => ([x, z, 1.0 - y], [dir[0], dir[2], -dir[1]]),
        _ => ([x, y, z], dir),
    };
    let [cx, cy, cz] = p;
    match d {
        [1, 0, 0] => [1.0 - cz, cy],
        [-1, 0, 0] => [cz, cy],
        [0, 1, 0] => [1.0 - cx, cz],
        [0, -1, 0] => [cx, 1.0 - cz],
        [0, 0, 1] => [cx, cy],
        _ => [1.0 - cx, cy],
    }
}

impl BranchQuad {
    /// The quad's corners, wound and ordered the way a cube's six faces
    /// are, each with the texture coordinate it samples.
    pub fn corners(&self, texels_per_block: i32) -> [CornerData; 4] {
        let t = texels_per_block as f32;
        let axis = side_axis(self.side);
        let [u, v] = cross_axes(axis);
        let [u0, v0, u1, v1] = self.rect.map(|value| value as f32 / t);
        let plane = self.plane as f32 / t;
        let at = |a: f32, b: f32| {
            let mut pos = [0.0; 3];
            pos[axis] = plane;
            pos[u] = a;
            pos[v] = b;
            pos
        };
        // Cube corner order per face, from `BlockFaces::six_faces`.
        let positions = match self.side {
            // +x: (y1,z1) (y0,z1) (y1,z0) (y0,z0) on axes (y, z) = (u, v)
            0 => [at(u1, v1), at(u0, v1), at(u1, v0), at(u0, v0)],
            // -x: (y1,z0) (y0,z0) (y1,z1) (y0,z1)
            1 => [at(u1, v0), at(u0, v0), at(u1, v1), at(u0, v1)],
            // +y: (x0,z1) (x1,z1) (x0,z0) (x1,z0) on axes (x, z) = (u, v)
            2 => [at(u0, v1), at(u1, v1), at(u0, v0), at(u1, v0)],
            // -y: (x1,z1) (x0,z1) (x1,z0) (x0,z0)
            3 => [at(u1, v1), at(u0, v1), at(u1, v0), at(u0, v0)],
            // +z: (x0,y0) (x1,y0) (x0,y1) (x1,y1) on axes (x, y) = (u, v)
            4 => [at(u0, v0), at(u1, v0), at(u0, v1), at(u1, v1)],
            // -z: (x1,y0) (x0,y0) (x1,y1) (x0,y1)
            _ => [at(u1, v0), at(u0, v0), at(u1, v1), at(u0, v1)],
        };
        // An end centres the rings on its part's own axis; a side samples
        // the voxel's own position.
        let shift = match self.texture {
            BranchTexture::End => {
                let mut shift = [0.0; 3];
                for a in cross_axes(self.axis) {
                    shift[a] = 0.5 - self.centre[a] as f32 / t;
                }
                shift
            }
            BranchTexture::Side => [0.0; 3],
        };
        positions.map(|pos| CornerData {
            pos,
            uv: grain_uv(
                self.side,
                self.axis,
                [pos[0] + shift[0], pos[1] + shift[1], pos[2] + shift[2]],
            ),
        })
    }
}

/// What branch layouts read about the blocks of a space. The mesher's
/// registry and the server's both answer it, so both lay a branch out the
/// same way.
pub trait BranchBlocks {
    fn branch_shape(&self, id: u32) -> Option<&BranchShape>;
    fn branch_sockets(&self, id: u32) -> &[BranchSocket];
    /// Whether the block is a shell of wide sections ([`Block::branch_shell`]).
    fn is_branch_shell(&self, id: u32) -> bool;
}

impl BranchBlocks for Registry {
    fn branch_shape(&self, id: u32) -> Option<&BranchShape> {
        self.get_block_by_id(id)
            .and_then(|block| block.branch.as_ref())
    }

    fn branch_sockets(&self, id: u32) -> &[BranchSocket] {
        self.get_block_by_id(id)
            .map_or(&[], |block| block.branch_sockets.as_slice())
    }

    fn is_branch_shell(&self, id: u32) -> bool {
        self.get_block_by_id(id)
            .is_some_and(|block| block.branch_shell)
    }
}

/// A branch voxel, resolved: a one-voxel branch or fin, or a cell of a wide
/// section with what it reads from its core.
#[derive(Clone, Copy, Debug)]
pub enum BranchCell<'a> {
    Voxel {
        id: u32,
        shape: &'a BranchShape,
        raw: u32,
    },
    Wide {
        /// The core's block: its shape, and the faces the cell wears.
        id: u32,
        shape: &'a BranchShape,
        core: [i32; 3],
        section: WideBranchSection,
        offset: [i32; 2],
        cut: bool,
    },
}

impl<'a> BranchCell<'a> {
    pub fn shape(&self) -> &'a BranchShape {
        match self {
            Self::Voxel { shape, .. } | Self::Wide { shape, .. } => shape,
        }
    }

    /// The block whose faces the voxel wears: its own, or its core's.
    pub fn dressed_by(&self) -> u32 {
        match self {
            Self::Voxel { id, .. } | Self::Wide { id, .. } => *id,
        }
    }

    fn is_cut_core(&self) -> bool {
        matches!(self, Self::Wide { cut: true, .. })
    }
}

/// The branch voxel at `voxel`, or `None` where there is none. A shell
/// whose offset does not lead to a core reaching back to it is `None` too:
/// it draws and collides as nothing.
pub fn branch_cell<'a, R: Fn(i32, i32, i32) -> u32 + ?Sized, B: BranchBlocks + ?Sized>(
    voxel: [i32; 3],
    raw_at: &R,
    blocks: &'a B,
) -> Option<BranchCell<'a>> {
    let [x, y, z] = voxel;
    let raw = raw_at(x, y, z);
    let id = BlockUtils::extract_id(raw);
    if let Some(shape) = blocks.branch_shape(id) {
        return Some(match shape.kind {
            BranchKind::Voxel | BranchKind::Fin => BranchCell::Voxel { id, shape, raw },
            BranchKind::Core => BranchCell::Wide {
                id,
                shape,
                core: voxel,
                section: WideBranchSection {
                    radius: WideBranchBits::size(raw),
                    texels_per_block: shape.texels_per_block,
                },
                offset: [0, 0],
                cut: WideBranchBits::is_cut(raw),
            },
        });
    }
    if !blocks.is_branch_shell(id) {
        return None;
    }
    let (dx, dz) = WideBranchBits::shell_offset(raw);
    if (dx, dz) == (0, 0) {
        return None;
    }
    let core = [x + dx, y, z + dz];
    let core_raw = raw_at(core[0], core[1], core[2]);
    let core_id = BlockUtils::extract_id(core_raw);
    let shape = blocks
        .branch_shape(core_id)
        .filter(|shape| shape.kind == BranchKind::Core)?;
    let section = WideBranchSection {
        radius: WideBranchBits::size(core_raw),
        texels_per_block: shape.texels_per_block,
    };
    let offset = [-dx, -dz];
    if offset.iter().any(|d| d.abs() > section.reach()) {
        return None;
    }
    Some(BranchCell::Wide {
        id: core_id,
        shape,
        core,
        section,
        offset,
        cut: false,
    })
}

/// How the branch voxel `cell` at `voxel` sees each of its neighbours.
fn sides_of<R: Fn(i32, i32, i32) -> u32 + ?Sized, B: BranchBlocks + ?Sized>(
    cell: &BranchCell,
    voxel: [i32; 3],
    raw_at: &R,
    blocks: &B,
) -> [BranchSide; SIDES] {
    let shape = cell.shape();
    let own_core = match cell {
        BranchCell::Wide { core, .. } => Some(*core),
        BranchCell::Voxel { .. } => None,
    };
    VOXEL_NEIGHBORS.map(|[dx, dy, dz]| {
        let at = [voxel[0] + dx, voxel[1] + dy, voxel[2] + dz];
        match branch_cell(at, raw_at, blocks) {
            Some(BranchCell::Voxel {
                shape: other, raw, ..
            }) if other.key == shape.key => shape.side(Some(other), &[], raw),
            Some(other @ BranchCell::Wide { core, section, .. })
                if other.shape().key == shape.key =>
            {
                if other.is_cut_core() {
                    BranchSide::Apart
                } else if own_core == Some(core) {
                    BranchSide::Section
                } else {
                    BranchSide::Branch {
                        radius: section.radius,
                        seat: BranchSeat::Centre,
                    }
                }
            }
            _ => shape.side(
                None,
                blocks.branch_sockets(BlockUtils::extract_id(raw_at(at[0], at[1], at[2]))),
                0,
            ),
        }
    })
}

/// What a wide section's cell at `voxel` reads from around it: whether the
/// trunk carries on past its level, and whether the cells below and above
/// cover its slice.
fn wide_cell<R: Fn(i32, i32, i32) -> u32 + ?Sized, B: BranchBlocks + ?Sized>(
    cell: &BranchCell,
    voxel: [i32; 3],
    raw_at: &R,
    blocks: &B,
) -> Option<WideCell> {
    let BranchCell::Wide {
        shape,
        core,
        section,
        offset,
        cut,
        ..
    } = *cell
    else {
        return None;
    };
    let wood = |at: [i32; 3]| match branch_cell(at, raw_at, blocks) {
        Some(other) => other.shape().key == shape.key && !other.is_cut_core(),
        None => blocks
            .branch_sockets(BlockUtils::extract_id(raw_at(at[0], at[1], at[2])))
            .iter()
            .any(|socket| socket.key == shape.key),
    };
    let own = (section.span(offset[0]), section.span(offset[1]));
    let covers = |dy: i32| match branch_cell([voxel[0], voxel[1] + dy, voxel[2]], raw_at, blocks) {
        Some(BranchCell::Wide {
            shape: other,
            section: beyond,
            offset: at,
            cut: false,
            ..
        }) if other.key == shape.key => match (own, (beyond.span(at[0]), beyond.span(at[1]))) {
            ((Some(a), Some(b)), (Some(c), Some(d))) => {
                c.0 <= a.0 && c.1 >= a.1 && d.0 <= b.0 && d.1 >= b.1
            }
            _ => false,
        },
        _ => false,
    };
    Some(WideCell {
        section,
        offset,
        cut,
        carries_on: [
            wood([core[0], core[1] - 1, core[2]]),
            wood([core[0], core[1] + 1, core[2]]),
        ],
        covered: [covers(-1), covers(1)],
    })
}

/// How the branch voxel at `voxel` is laid out, with the block whose faces
/// it wears; `None` where there is no branch voxel to lay out. `raw_at`
/// reads a voxel word anywhere a layout may look: a shell's core, and the
/// neighbours of the voxel and of that core.
pub fn branch_layout_at<R: Fn(i32, i32, i32) -> u32 + ?Sized, B: BranchBlocks + ?Sized>(
    voxel: [i32; 3],
    raw_at: &R,
    blocks: &B,
) -> Option<(BranchLayout, u32)> {
    let cell = branch_cell(voxel, raw_at, blocks)?;
    let sides = sides_of(&cell, voxel, raw_at, blocks);
    let layout = match cell {
        BranchCell::Voxel { shape, raw, .. } => {
            let stage = BlockUtils::extract_stage(raw);
            match shape.kind {
                BranchKind::Fin => BranchLayout::fin(shape, stage, shape.fin_height(raw), sides),
                _ => BranchLayout::new(shape, stage, sides),
            }
        }
        BranchCell::Wide { shape, .. } => {
            BranchLayout::wide(shape, wide_cell(&cell, voxel, raw_at, blocks)?, sides)
        }
    };
    Some((layout, cell.dressed_by()))
}

/// The faces a branch voxel draws, built on the side and end faces of the
/// block it wears (its own, or a shell's core's) so they carry those
/// textures. Laid in world space: a branch never rotates.
pub(super) fn branch_faces<S: VoxelAccess>(
    voxel: [i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<(BlockFace, bool)> {
    let raw_at = |x: i32, y: i32, z: i32| space.get_raw_voxel(x, y, z);
    let Some((layout, dressed_by)) = branch_layout_at(voxel, &raw_at, registry) else {
        return Vec::new();
    };
    let Some(dress) = registry.get_block_by_id(dressed_by) else {
        return Vec::new();
    };
    let Some(shape) = dress.branch.as_ref() else {
        return Vec::new();
    };
    let (Some(side_face), Some(end_face)) = (
        dress.faces.iter().find(|face| face.name == shape.side_face),
        dress.faces.iter().find(|face| face.name == shape.end_face),
    ) else {
        return Vec::new();
    };
    let [vx, vy, vz] = voxel;
    let beyond = VOXEL_NEIGHBORS.map(|[dx, dy, dz]| {
        match registry.get_block_by_id(space.get_voxel(vx + dx, vy + dy, vz + dz)) {
            Some(block) if block.is_opaque => BranchBeyond::Opaque,
            Some(block) if block.is_see_through => BranchBeyond::SeeThrough,
            _ => BranchBeyond::Other,
        }
    });
    layout
        .faces(&beyond)
        .into_iter()
        .map(|quad| {
            let source = match quad.texture {
                BranchTexture::Side => side_face,
                BranchTexture::End => end_face,
            };
            let face = BlockFace {
                dir: VOXEL_NEIGHBORS[quad.side],
                corners: quad.corners(layout.texels_per_block),
                independent: false,
                isolated: false,
                emissive: 0.0,
                stage_tint_mask: 0,
                pigment_mask: 0,
                ..source.clone()
            };
            (face, true)
        })
        .collect()
}
