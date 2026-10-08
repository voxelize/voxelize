//! `zones`: paints keyed zones through roles.
//!
//! Landforms write a column's zone (`cliff`, `beach`, `dune`, a game key
//! declared in `spec.zones`); this surfacer gives each zone its material
//! at the top. Zone writers arrive with the landforms (P2b on); until then
//! no column carries a zone and this surfacer paints nothing.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::landscape::spec::{SpecError, Validate, Validator};
use crate::landscape::surface::{MaterialRuns, PaintColumn, PaintCtx, Surfacer, ZoneKey};

/// One zone's paint.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ZonePaintM {
    /// Role painted.
    pub role: String,
    /// Depth of the paint below the top, in voxels.
    pub depth: u16,
}

/// Params of `zones`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ZonesParams {
    /// Paint by zone key.
    pub zones: BTreeMap<String, ZonePaintM>,
}

impl Validate for ZonesParams {
    fn validate(&self, v: &mut Validator) {
        for (k, z) in &self.zones {
            v.check(
                &format!("zones.{k}.depth"),
                (1..=16).contains(&z.depth),
                "depth must be 1..=16",
            );
        }
    }
}

/// Zone paint.
pub struct Zones {
    paint: Vec<(ZoneKey, Option<u32>, i32)>,
}

impl Surfacer for Zones {
    const KIND: &'static str = "zones";
    const VERSION: u32 = 1;
    type Params = ZonesParams;

    fn build(p: Self::Params, cx: &mut PaintCtx<'_>) -> Result<Self, SpecError> {
        let mut paint = Vec::new();
        for (key, z) in &p.zones {
            let zone = cx.zone(&format!("zones.{key}"), key)?;
            let block = cx.role(&format!("zones.{key}.role"), &z.role)?;
            paint.push((zone, block, z.depth as i32));
        }
        Ok(Self { paint })
    }

    fn paint(&self, col: &PaintColumn<'_>, runs: &mut MaterialRuns) {
        if col.zone == ZoneKey::NONE {
            return;
        }
        for &(zone, block, depth) in &self.paint {
            if zone == col.zone {
                if let Some(b) = block {
                    runs.set_depth(0, depth - 1, b);
                }
            }
        }
    }
}
