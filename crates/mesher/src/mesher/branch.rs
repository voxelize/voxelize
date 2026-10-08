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
use voxelize_core::{BlockFace, CornerData, VoxelAccess, AABB};

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
    /// A branch of the same key.
    Branch { radius: u32, seat: BranchSeat },
    /// A block that takes this key's branches up to `max_radius`.
    Socket { max_radius: u32 },
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

    /// How a voxel of this shape sees a neighbour that is `branch` (its
    /// shape, if any) with `sockets`, at `stage`.
    pub fn side(
        &self,
        branch: Option<&BranchShape>,
        sockets: &[BranchSocket],
        stage: u32,
    ) -> BranchSide {
        if let Some(other) = branch.filter(|other| other.key == self.key) {
            return BranchSide::Branch {
                radius: other.radius(stage),
                seat: other.seat,
            };
        }
        sockets
            .iter()
            .find(|socket| socket.key == self.key)
            .map_or(BranchSide::Apart, |socket| BranchSide::Socket {
                max_radius: socket.max_radius,
            })
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
    /// The axis the core's grain runs along.
    pub axis: usize,
    pub parts: Vec<BranchPart>,
}

/// The joint a branch of `radius` makes with what lies on one side.
fn joint_radius(radius: u32, side: BranchSide) -> u32 {
    match side {
        BranchSide::Apart => 0,
        BranchSide::Branch { radius: other, .. } => radius.min(other),
        BranchSide::Socket { max_radius } => {
            if radius <= max_radius {
                radius
            } else {
                0
            }
        }
    }
}

impl BranchLayout {
    /// Lay out a voxel of `shape` at `stage` whose neighbours are `sides`.
    pub fn new(shape: &BranchShape, stage: u32, sides: [BranchSide; SIDES]) -> Self {
        let t = shape.texels_per_block as i32;
        let c = t / 2;
        let radius = shape.radius(stage);
        let r = radius as i32;
        let seat = shape.seat;
        let joints = sides.map(|side| joint_radius(radius, side));

        // A horizontal joint lies along the floor when either end of it
        // does; a vertical one always runs up the middle.
        let floor_joint = |side: usize| {
            side_axis(side) != 1
                && (seat == BranchSeat::Floor
                    || matches!(
                        sides[side],
                        BranchSide::Branch {
                            seat: BranchSeat::Floor,
                            ..
                        }
                    ))
        };

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
            BranchSeat::Floor => (0, r),
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
            let floor = floor_joint(side);
            let mut min = [c - j; 3];
            let mut max = [c + j; 3];
            let mut centre = [c; 3];
            if floor {
                min[1] = 0;
                max[1] = j;
                centre[1] = 0;
            }
            min[along] = start;
            max[along] = end;
            parts.push(BranchPart {
                kind: BranchPartKind::Arm(side),
                min,
                max,
                axis: along,
                centre,
            });
        }

        Self {
            texels_per_block: t,
            radius,
            seat,
            sides,
            joints,
            axis,
            parts,
        }
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
        let floor = side_axis(side) != 1
            && (self.seat == BranchSeat::Floor
                || matches!(
                    self.sides[side],
                    BranchSide::Branch {
                        seat: BranchSeat::Floor,
                        ..
                    }
                ));
        let [u, v] = cross_axes(side_axis(side));
        let span = |axis: usize| {
            if floor && axis == 1 {
                (0, j)
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

    /// Every face this voxel shows, given what lies beyond each of its sides.
    pub fn faces(&self, beyond: &[BranchBeyond; SIDES]) -> Vec<BranchQuad> {
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

                // Another part pressed against this face from the far side.
                let covered = self.parts.iter().enumerate().any(|(other, box_)| {
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
                });
                if covered {
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

/// How the voxel at `voxel` of `shape` sees each of its neighbours.
pub(super) fn branch_sides<S: VoxelAccess>(
    shape: &BranchShape,
    voxel: [i32; 3],
    space: &S,
    registry: &Registry,
) -> [BranchSide; SIDES] {
    VOXEL_NEIGHBORS.map(|[dx, dy, dz]| {
        let (x, y, z) = (voxel[0] + dx, voxel[1] + dy, voxel[2] + dz);
        registry
            .get_block_by_id(space.get_voxel(x, y, z))
            .map_or(BranchSide::Apart, |block| {
                shape.side(
                    block.branch.as_ref(),
                    &block.branch_sockets,
                    space.get_voxel_stage(x, y, z),
                )
            })
    })
}

/// The faces a branch voxel draws, built on its block's side and end faces
/// so they carry those faces' textures. Laid in world space: a branch never
/// rotates.
pub(super) fn branch_faces<S: VoxelAccess>(
    block: &Block,
    shape: &BranchShape,
    voxel: [i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<(BlockFace, bool)> {
    let (Some(side_face), Some(end_face)) = (
        block.faces.iter().find(|face| face.name == shape.side_face),
        block.faces.iter().find(|face| face.name == shape.end_face),
    ) else {
        return Vec::new();
    };
    let [vx, vy, vz] = voxel;
    let layout = BranchLayout::new(
        shape,
        space.get_voxel_stage(vx, vy, vz),
        branch_sides(shape, voxel, space, registry),
    );
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
