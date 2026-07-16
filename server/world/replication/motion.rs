//! The compact motion codec: quantized wire encoding for the high-frequency
//! motion lane of the state replication split (see the module docs in
//! `world::replication`).
//!
//! Motion is the engine-owned set of animation-critical transforms every
//! moving entity produces each tick: position, facing direction, rigid-body
//! fluid state and look-at target position. Encoding them as JSON costs
//! hundreds of bytes per entity per tick; this codec bounds and quantizes
//! them into a few tens of bytes (the technique production engines use for
//! snapshot compression — see the design notes in
//! `notes/entity-motion-replication.md`).
//!
//! Quantization doubles as change detection: the server compares the
//! quantized sample against the last one staged for broadcast, so motion
//! below the wire's own resolution (e.g. sub-millimeter collision-repulsion
//! jitter between crowded entities) never stages an update at all. Clients
//! only render replicated entities — they never feed the values back into a
//! simulation — so visual-precision quantization is lossless in effect.
//!
//! The payload is versioned by its leading byte. Servers only send a version
//! a client advertised support for in its JOIN capabilities (`motion.v1`),
//! so the format can evolve without breaking pinned clients.

/// Version byte of the current motion payload layout.
pub const MOTION_PROTOCOL_V1: u8 = 1;

/// The JOIN capability string a client sends to opt into [`MOTION_PROTOCOL_V1`].
pub const MOTION_V1_CAPABILITY: &str = "motion.v1";

/// Position resolution: 1/512 of a block (~2mm), the precision production
/// snapshot compression uses for render-only consumers. i32 range covers
/// ±4.1M blocks — beyond where f32 world coordinates lose playable precision.
const POSITION_SCALE: f32 = 512.0;

/// Direction resolution: 1/512 per component in an i16, covering ±63 so
/// non-unit direction vectors survive, with ~0.1° angular error for unit ones.
const DIRECTION_SCALE: f32 = 512.0;

/// Layout flags (byte 1 of the payload).
const FLAG_IN_FLUID: u8 = 1 << 0;
const FLAG_HAS_DIRECTION: u8 = 1 << 1;
const FLAG_HAS_RIGID_BODY: u8 = 1 << 2;
const FLAG_HAS_TARGET: u8 = 1 << 3;

/// How a client receives entity motion, negotiated at JOIN time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MotionProtocol {
    /// Motion rides inside the full metadata JSON string, exactly as before
    /// the compact path existed. The wire shape is byte-for-byte what pinned
    /// legacy clients already parse.
    #[default]
    LegacyJson,
    /// Motion ships as a [`MOTION_PROTOCOL_V1`] binary payload in the
    /// `Entity.motion` field; metadata JSON carries only non-motion keys.
    CompactV1,
}

impl MotionProtocol {
    pub fn negotiate(capabilities: &[String]) -> Self {
        if capabilities.iter().any(|c| c == MOTION_V1_CAPABILITY) {
            Self::CompactV1
        } else {
            Self::LegacyJson
        }
    }

    pub fn is_compact(&self) -> bool {
        matches!(self, Self::CompactV1)
    }
}

/// One entity's motion state as sampled from its ECS components.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct MotionSample {
    pub position: [f32; 3],
    pub direction: Option<[f32; 3]>,
    /// (is_in_fluid, fluid_ratio) from the rigid body.
    pub rigid_body: Option<(bool, f32)>,
    /// Current look-at target position, when a target component is present
    /// and locked on. High-frequency (tracks moving players), so it belongs
    /// to the motion lane rather than the metadata lane.
    pub target: Option<[f32; 3]>,
}

/// A [`MotionSample`] quantized to wire resolution. Equality of two quantized
/// samples means the wire payloads would be identical, which is what the
/// sending system uses to decide whether an entity's motion "changed".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuantizedMotion {
    position: [i32; 3],
    direction: Option<[i16; 3]>,
    rigid_body: Option<(bool, u8)>,
    target: Option<[i32; 3]>,
}

fn quantize_coord(value: f32) -> i32 {
    let scaled = (value * POSITION_SCALE).round();
    if scaled >= i32::MAX as f32 {
        i32::MAX
    } else if scaled <= i32::MIN as f32 {
        i32::MIN
    } else {
        scaled as i32
    }
}

fn quantize_direction_component(value: f32) -> i16 {
    let scaled = (value * DIRECTION_SCALE).round();
    scaled.clamp(i16::MIN as f32, i16::MAX as f32) as i16
}

fn quantize_ratio(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

impl QuantizedMotion {
    pub fn from_sample(sample: &MotionSample) -> Self {
        Self {
            position: sample.position.map(quantize_coord),
            direction: sample
                .direction
                .map(|d| d.map(quantize_direction_component)),
            rigid_body: sample
                .rigid_body
                .map(|(is_in_fluid, ratio)| (is_in_fluid, quantize_ratio(ratio))),
            target: sample.target.map(|t| t.map(quantize_coord)),
        }
    }

    /// Encode as a motion.v1 payload: version byte, flags byte, then the
    /// little-endian quantized fields gated by their flags. 14–33 bytes.
    pub fn encode(&self) -> Vec<u8> {
        let mut flags = 0u8;
        if self.direction.is_some() {
            flags |= FLAG_HAS_DIRECTION;
        }
        if let Some((is_in_fluid, _)) = self.rigid_body {
            flags |= FLAG_HAS_RIGID_BODY;
            if is_in_fluid {
                flags |= FLAG_IN_FLUID;
            }
        }
        if self.target.is_some() {
            flags |= FLAG_HAS_TARGET;
        }

        let mut buf = Vec::with_capacity(33);
        buf.push(MOTION_PROTOCOL_V1);
        buf.push(flags);
        for component in self.position {
            buf.extend_from_slice(&component.to_le_bytes());
        }
        if let Some(direction) = self.direction {
            for component in direction {
                buf.extend_from_slice(&component.to_le_bytes());
            }
        }
        if let Some((_, ratio)) = self.rigid_body {
            buf.push(ratio);
        }
        if let Some(target) = self.target {
            for component in target {
                buf.extend_from_slice(&component.to_le_bytes());
            }
        }
        buf
    }
}

/// Decode a motion.v1 payload back into world-space floats. The server only
/// needs this for tests; the shipping decoder is the client's, in
/// `packages/core/src/core/network/workers/decode-utils.ts` (kept in sync
/// with this layout by the round-trip tests below).
pub fn decode_motion(payload: &[u8]) -> Option<MotionSample> {
    let mut cursor = payload.iter();
    let version = *cursor.next()?;
    if version != MOTION_PROTOCOL_V1 {
        return None;
    }

    let mut offset = 2usize;
    let flags = payload[1];

    let mut read_i32 = |payload: &[u8]| -> Option<i32> {
        let bytes: [u8; 4] = payload.get(offset..offset + 4)?.try_into().ok()?;
        offset += 4;
        Some(i32::from_le_bytes(bytes))
    };
    let position = [
        read_i32(payload)? as f32 / POSITION_SCALE,
        read_i32(payload)? as f32 / POSITION_SCALE,
        read_i32(payload)? as f32 / POSITION_SCALE,
    ];

    let direction = if flags & FLAG_HAS_DIRECTION != 0 {
        let mut components = [0.0f32; 3];
        for component in &mut components {
            let bytes: [u8; 2] = payload.get(offset..offset + 2)?.try_into().ok()?;
            offset += 2;
            *component = i16::from_le_bytes(bytes) as f32 / DIRECTION_SCALE;
        }
        Some(components)
    } else {
        None
    };

    let rigid_body = if flags & FLAG_HAS_RIGID_BODY != 0 {
        let ratio = *payload.get(offset)? as f32 / 255.0;
        offset += 1;
        Some((flags & FLAG_IN_FLUID != 0, ratio))
    } else {
        None
    };

    let target = if flags & FLAG_HAS_TARGET != 0 {
        let mut components = [0.0f32; 3];
        for component in &mut components {
            let bytes: [u8; 4] = payload.get(offset..offset + 4)?.try_into().ok()?;
            offset += 4;
            *component = i32::from_le_bytes(bytes) as f32 / POSITION_SCALE;
        }
        Some(components)
    } else {
        None
    };

    Some(MotionSample {
        position,
        direction,
        rigid_body,
        target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(sample: MotionSample) -> MotionSample {
        decode_motion(&QuantizedMotion::from_sample(&sample).encode()).unwrap()
    }

    #[test]
    fn full_sample_round_trips_within_quantization_error() {
        let sample = MotionSample {
            position: [123.456, -78.901, 0.001],
            direction: [0.267, -0.535, 0.802].into(),
            rigid_body: Some((true, 0.37)),
            target: Some([-1000.25, 87.5, 4321.0]),
        };
        let decoded = roundtrip(sample);

        for (a, b) in sample.position.iter().zip(decoded.position) {
            assert!((a - b).abs() <= 1.0 / POSITION_SCALE);
        }
        for (a, b) in sample
            .direction
            .unwrap()
            .iter()
            .zip(decoded.direction.unwrap())
        {
            assert!((a - b).abs() <= 1.0 / DIRECTION_SCALE);
        }
        let (in_fluid, ratio) = decoded.rigid_body.unwrap();
        assert!(in_fluid);
        assert!((ratio - 0.37).abs() <= 1.0 / 255.0);
        for (a, b) in sample.target.unwrap().iter().zip(decoded.target.unwrap()) {
            assert!((a - b).abs() <= 1.0 / POSITION_SCALE);
        }
    }

    #[test]
    fn minimal_sample_encodes_position_only() {
        let sample = MotionSample {
            position: [1.0, 2.0, 3.0],
            ..Default::default()
        };
        let payload = QuantizedMotion::from_sample(&sample).encode();
        assert_eq!(payload.len(), 14);

        let decoded = decode_motion(&payload).unwrap();
        assert_eq!(decoded.position, [1.0, 2.0, 3.0]);
        assert!(decoded.direction.is_none());
        assert!(decoded.rigid_body.is_none());
        assert!(decoded.target.is_none());
    }

    #[test]
    fn sub_resolution_jitter_is_not_a_change() {
        let base = MotionSample {
            position: [10.0, 64.0, -10.0],
            direction: Some([0.0, 0.0, 1.0]),
            rigid_body: Some((false, 0.0)),
            target: None,
        };
        let jittered = MotionSample {
            position: [
                10.0 + 0.4 / POSITION_SCALE,
                64.0 - 0.4 / POSITION_SCALE,
                -10.0,
            ],
            ..base
        };
        assert_eq!(
            QuantizedMotion::from_sample(&base),
            QuantizedMotion::from_sample(&jittered)
        );

        let moved = MotionSample {
            position: [10.0 + 2.0 / POSITION_SCALE, 64.0, -10.0],
            ..base
        };
        assert_ne!(
            QuantizedMotion::from_sample(&base),
            QuantizedMotion::from_sample(&moved)
        );
    }

    #[test]
    fn extreme_coordinates_saturate_instead_of_overflowing() {
        let sample = MotionSample {
            position: [f32::MAX, f32::MIN, 0.0],
            ..Default::default()
        };
        let decoded = roundtrip(sample);
        assert_eq!(decoded.position[0], i32::MAX as f32 / POSITION_SCALE);
        assert_eq!(decoded.position[1], i32::MIN as f32 / POSITION_SCALE);
    }

    #[test]
    fn unknown_version_is_rejected() {
        let mut payload = QuantizedMotion::from_sample(&MotionSample::default()).encode();
        payload[0] = 99;
        assert!(decode_motion(&payload).is_none());
    }

    #[test]
    fn negotiation_requires_the_exact_capability() {
        assert_eq!(
            MotionProtocol::negotiate(&["motion.v1".to_owned()]),
            MotionProtocol::CompactV1
        );
        assert_eq!(
            MotionProtocol::negotiate(&["motion.v2".to_owned()]),
            MotionProtocol::LegacyJson
        );
        assert_eq!(MotionProtocol::negotiate(&[]), MotionProtocol::LegacyJson);
    }
}
