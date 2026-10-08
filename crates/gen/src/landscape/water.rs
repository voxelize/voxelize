//! Water as data.
//!
//! A water layer is (body, level, bed): writers declare it, the engine
//! resolves it after composition against final ground, so later ground
//! motion can never leave water hanging or buried (docs/landscape.md,
//! section 5). This phase carries the types, the implicit sea layer,
//! `Sources` stamping and the column queries; declarations, beds, the
//! void-fill rule, aquifers and the other stamp modes arrive in P4.
//!
//! `frame.sea` is the sea level in the same sense as a layer's `level`:
//! the y of the highest sea water voxel. Every column whose final top is
//! below it gets the implicit `SEA` layer `[top + 1, sea]`.

use serde::{Deserialize, Serialize};
use smallvec::SmallVec;

use crate::stream::fnv1a_64;

/// A water kind: built-in constants below; games declare more in
/// `spec.water_kinds`, assigned from 256 up in sorted key order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct WaterKind(pub u16);

#[allow(missing_docs)]
impl WaterKind {
    pub const SEA: Self = Self(0);
    pub const LAKE: Self = Self(1);
    pub const POND: Self = Self(2);
    pub const RIVER: Self = Self(3);
    pub const CREEK: Self = Self(4);
    pub const FALL: Self = Self(5);
    pub const PLUNGE_POOL: Self = Self(6);
    pub const SPRING: Self = Self(7);
    pub const MARSH: Self = Self(8);
    pub const AQUIFER: Self = Self(9);
    pub const PERCHED: Self = Self(10);
    pub const LAVA_POOL: Self = Self(11);
    /// The first id of a game-declared kind.
    pub const FIRST_GAME: u16 = 256;
}

/// A water body's id: a hash of (node salt, plan cell, index); the sea is
/// one well-known id.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct WaterBodyId(pub u64);

impl WaterBodyId {
    /// The sea.
    pub fn sea() -> Self {
        Self(fnv1a_64(b"engine.water.sea"))
    }
}

/// How water moves.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Flow {
    /// Standing water.
    Still,
    /// A current.
    Downstream {
        /// Unit direction x.
        dx: f32,
        /// Unit direction z.
        dz: f32,
        /// Blocks per second.
        speed: f32,
    },
    /// A curtain.
    Falling,
}

/// How a layer becomes voxels. This phase stamps `Sources` only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StampMode {
    /// Stage 0 throughout (sea, lakes, ponds, aquifers, pools).
    Sources,
}

/// A resolved water layer in one column: fluid fills `[bottom, level]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WaterLayer {
    /// The body it belongs to.
    pub body: WaterBodyId,
    /// Its kind.
    pub kind: WaterKind,
    /// The resolved block id of its fluid role.
    pub fluid: u32,
    /// The y of its highest fluid voxel.
    pub level: i32,
    /// The y of its lowest fluid voxel.
    pub bottom: i32,
    /// How it moves.
    pub flow: Flow,
    /// How it is stamped.
    pub stamp: StampMode,
}

impl WaterLayer {
    /// Fluid voxels in the layer.
    pub fn depth(&self) -> i32 {
        self.level - self.bottom + 1
    }

    /// Whether `y` holds this layer's fluid.
    pub fn contains(&self, y: i32) -> bool {
        y >= self.bottom && y <= self.level
    }
}

/// Every water layer of a column, top-down and disjoint.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WaterColumn {
    /// Layers, top-down.
    pub layers: SmallVec<[WaterLayer; 2]>,
}

impl WaterColumn {
    /// Whether the column holds no water.
    pub fn is_dry(&self) -> bool {
        self.layers.is_empty()
    }

    /// The highest layer.
    pub fn top(&self) -> Option<&WaterLayer> {
        self.layers.first()
    }
}

/// What a fluid query finds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WaterHit {
    /// Its kind.
    pub kind: WaterKind,
    /// Its fluid block id.
    pub fluid: u32,
    /// Its body.
    pub body: WaterBodyId,
    /// The y of the surface (the highest fluid voxel).
    pub surface: i32,
    /// Fluid voxels from the queried voxel up to the surface, inclusive.
    pub depth: i32,
    /// How it moves.
    pub flow: Flow,
    /// Whether the water has no open surface (aquifers).
    pub enclosed: bool,
}

/// The resolved sea of a landscape.
#[derive(Clone, Copy, Debug)]
pub struct SeaModel {
    /// Whether the implicit sea exists.
    pub enabled: bool,
    /// Sea level.
    pub level: i32,
    /// Fluid block id.
    pub fluid: u32,
}

impl SeaModel {
    /// The sea layer of a column whose solid top is `top`, if any.
    pub fn layer(&self, top: i32) -> Option<WaterLayer> {
        if self.enabled && top < self.level {
            Some(WaterLayer {
                body: WaterBodyId::sea(),
                kind: WaterKind::SEA,
                fluid: self.fluid,
                level: self.level,
                bottom: top + 1,
                flow: Flow::Still,
                stamp: StampMode::Sources,
            })
        } else {
            None
        }
    }

    /// The water column of a column whose solid top is `top`.
    pub fn column(&self, top: i32) -> WaterColumn {
        let mut c = WaterColumn::default();
        if let Some(l) = self.layer(top) {
            c.layers.push(l);
        }
        c
    }
}

/// The fluid at `y` in `column`, if any.
pub fn hit_in(column: &WaterColumn, y: i32) -> Option<WaterHit> {
    column
        .layers
        .iter()
        .find(|l| l.contains(y))
        .map(|l| WaterHit {
            kind: l.kind,
            fluid: l.fluid,
            body: l.body,
            surface: l.level,
            depth: l.level - y + 1,
            flow: l.flow,
            enclosed: false,
        })
}
