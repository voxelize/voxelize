//! The landscape kernel toolkits' contract: golden pins with error bounds,
//! the one-sided soft clamps, C1 profiles with inverses, strata that never
//! invert a slope, seam-free lattices whose culled evaluation equals the
//! unculled one, conservative tile gates, deterministic floods, settle
//! checks run with the engine's own fluid updater, cost-only caches and the
//! pinned seed lanes.

use std::collections::BTreeSet;

use voxelize::{Block, BlockUtils, FluidConfig, Registry, VoxelPacker};
use voxelize_gen::landscape::cache::ClockCache;
use voxelize_gen::landscape::flood::{
    lake_flood, priority_flood, Divide, LakeLimits, LakeReject, NO_RECEIVER,
};
use voxelize_gen::landscape::geometry::{
    gate_upper_bound, segment_distance, tile_gate_bound, zero_line_distance, ArcSchedule,
    FeatureFrame, Footprint, IsoEnd, IsoTracer,
};
use voxelize_gen::landscape::lattice::{Interval, Lattice, LatticeSpec, VoxelBox};
use voxelize_gen::landscape::math::*;
use voxelize_gen::landscape::network::{ChannelNet, NetVertex};
use voxelize_gen::landscape::profile::{
    Cone, DuneWave, Face, FaceSpec, Monotone, Profile, SWall, SlotLedge, SlotSection, SlotSpec,
    Wall,
};
use voxelize_gen::landscape::settle::{FluidRules, SettleBox, Settler};
use voxelize_gen::landscape::strata::{BandPart, BandSpec, BandTable};
use voxelize_gen::landscape::{SeedLane, SeedPhase};
use voxelize_gen::{fnv1a_64, mix64, stream_seed_lane, HashStream, Perlin, FIRST_LAYER_LANE};

// ---------------------------------------------------------------------------
// Golden pins. Any change here changes worlds: re-pin only with an engine
// algorithm version bump (`print_math_pins` regenerates the table).

fn eval_pin(name: &str, a: [f64; 3]) -> f64 {
    let linear = |x: f64, z: f64| 0.3 * x - 0.7 * z;
    match name {
        "clamp01" => clamp01(a[0]),
        "lerp" => lerp(a[0], a[1], a[2]),
        "smoothstep" => smoothstep(a[0], a[1], a[2]),
        "smoothstep_d" => smoothstep_d(a[0], a[1], a[2]),
        "smootherstep_d" => smootherstep_d(a[0], a[1], a[2]),
        "soft_ramp" => soft_ramp(a[0], a[1]),
        "soft_ramp_d" => soft_ramp_d(a[0], a[1]),
        "soft_down_d" => soft_down_d(a[0], a[1], a[2]),
        "soft_up_d" => soft_up_d(a[0], a[1], a[2]),
        "soft_ceiling_d" => soft_ceiling_d(a[0], a[1], a[2]),
        "psin_turns" => psin_turns(a[0]),
        "smootherstep" => smootherstep(a[0], a[1], a[2]),
        "soft_down" => soft_down(a[0], a[1], a[2]),
        "soft_up" => soft_up(a[0], a[1], a[2]),
        "smin" => smin(a[0], a[1], a[2]),
        "smax" => smax(a[0], a[1], a[2]),
        "soft_ceiling" => soft_ceiling(a[0], a[1], a[2]),
        "pow_smooth" => pow_smooth(a[0], a[1]),
        "pow_smooth_d" => pow_smooth_d(a[0], a[1]),
        "bias" => bias(a[0], a[1]),
        "gain" => gain(a[0], a[1]),
        "psin" => psin(a[0]),
        "pcos" => pcos(a[0]),
        "pseudo_angle" => pseudo_angle(a[0], a[1]),
        "unit_dir.x" => unit_dir(a[0] as i64, a[1] as u32).0,
        "unit_dir.z" => unit_dir(a[0] as i64, a[1] as u32).1,
        "ring_noise" => ring_noise(linear, (10.0, 20.0), (a[0], a[1]), a[2]),
        "exp2_p" => exp2_p(a[0]),
        "log2_p" => log2_p(a[0]),
        "fmax" => a[0].fmax(a[1]),
        "fmin" => a[0].fmin(a[1]),
        other => panic!("no pin evaluator for {other}"),
    }
}

/// The reference a pin is measured against, and its error bound.
fn reference(name: &str, a: [f64; 3]) -> Option<(f64, f64)> {
    let ramp = |d: f64, k: f64| {
        if d <= 0.0 {
            0.0
        } else if d < k {
            d * d / (2.0 * k)
        } else {
            d - k / 2.0
        }
    };
    let rel = |v: f64, r: f64| r * v.abs().max(1.0);
    Some(match name {
        "psin" => (a[0].sin(), 2e-7),
        "pcos" => (a[0].cos(), 2e-7),
        "soft_down" => (a[0] - ramp(a[0] - a[1], a[2]), rel(a[0], 1e-14)),
        "soft_up" => (a[0] + ramp(a[1] - a[0], a[2]), rel(a[0], 1e-14)),
        "soft_ramp" => (ramp(a[0], a[1]), 1e-14),
        "psin_turns" => ((std::f64::consts::TAU * a[0]).sin(), 2e-7),
        "smin" if a[2] > 0.0 => (
            a[0].min(a[1]) - ((a[2] - (a[0] - a[1]).abs()).max(0.0) / a[2]).powi(2) * a[2] / 4.0,
            1e-14,
        ),
        "pow_smooth" if (8.0 * a[1]).fract() == 0.0 => (a[0].powf(a[1]), 1e-15),
        "pow_smooth_d" if (8.0 * a[1]).fract() == 0.0 => (a[1] * a[0].powf(a[1] - 1.0), 1e-15),
        "unit_dir.x" => ((std::f64::consts::TAU * a[0] / a[1]).cos(), 1e-15),
        "unit_dir.z" => ((std::f64::consts::TAU * a[0] / a[1]).sin(), 1e-15),
        "exp2_p" => (a[0].exp2(), rel(a[0].exp2(), 1e-15)),
        "log2_p" => (a[0].log2(), rel(a[0].log2(), 1e-15)),
        _ => return None,
    })
}

fn pin_inputs() -> Vec<(&'static str, [f64; 3])> {
    let mut v: Vec<(&'static str, [f64; 3])> = vec![
        ("clamp01", [-0.5, 0.0, 0.0]),
        ("clamp01", [0.37, 0.0, 0.0]),
        ("lerp", [2.0, 7.0, 0.3]),
        ("smoothstep_d", [0.0, 1.0, 0.3]),
        ("smoothstep_d", [2.0, 5.0, 4.2]),
        ("smootherstep_d", [0.0, 1.0, 0.3]),
        ("smootherstep_d", [2.0, 5.0, 4.2]),
        ("soft_ramp", [-1.0, 6.0, 0.0]),
        ("soft_ramp", [2.5, 6.0, 0.0]),
        ("soft_ramp", [9.0, 6.0, 0.0]),
        ("soft_ramp_d", [2.5, 6.0, 0.0]),
        ("soft_down_d", [10.0, 7.0, 6.0]),
        ("soft_up_d", [7.0, 10.0, 6.0]),
        ("soft_ceiling_d", [470.0, 450.0, 498.0]),
        ("psin_turns", [0.1, 0.0, 0.0]),
        ("psin_turns", [-3.7, 0.0, 0.0]),
        ("smoothstep", [0.0, 1.0, 0.3]),
        ("smoothstep", [2.0, 5.0, 4.2]),
        ("smootherstep", [0.0, 1.0, 0.3]),
        ("smootherstep", [2.0, 5.0, 4.2]),
        ("soft_down", [10.0, 4.0, 6.0]),
        ("soft_down", [10.0, 7.0, 6.0]),
        ("soft_down", [10.0, 12.0, 6.0]),
        ("soft_down", [5.5, 5.4, 2.0]),
        ("soft_down", [137.25, 101.5, 5.0]),
        ("soft_up", [4.0, 10.0, 6.0]),
        ("soft_up", [7.0, 10.0, 6.0]),
        ("soft_up", [12.0, 10.0, 6.0]),
        ("soft_up", [88.125, 90.0, 6.0]),
        ("smin", [1.0, 2.0, 0.5]),
        ("smin", [1.0, 1.2, 0.5]),
        ("smin", [-3.0, 4.0, 10.0]),
        ("smax", [1.0, 1.2, 0.5]),
        ("smax", [-3.0, 4.0, 10.0]),
        ("soft_ceiling", [400.0, 450.0, 498.0]),
        ("soft_ceiling", [470.0, 450.0, 498.0]),
        ("soft_ceiling", [1.0e6, 450.0, 498.0]),
        ("pow_smooth", [0.3, 1.35, 0.0]),
        ("pow_smooth", [0.5, 2.6, 0.0]),
        ("pow_smooth", [0.77, 0.75, 0.0]),
        ("pow_smooth", [0.123, 1.875, 0.0]),
        ("pow_smooth", [0.9, 2.2, 0.0]),
        ("pow_smooth", [0.0, 1.5, 0.0]),
        ("pow_smooth", [0.9, 3.0, 0.0]),
        ("pow_smooth", [0.25, 0.1, 0.0]),
        ("pow_smooth", [0.64, 2.625, 0.0]),
        ("pow_smooth_d", [0.3, 1.35, 0.0]),
        ("pow_smooth_d", [0.5, 2.6, 0.0]),
        ("pow_smooth_d", [0.123, 1.875, 0.0]),
        ("pow_smooth_d", [0.0, 1.5, 0.0]),
        ("pow_smooth_d", [0.9, 3.0, 0.0]),
        ("pow_smooth_d", [0.5, 1.0, 0.0]),
        ("pow_smooth_d", [0.93, 1.35, 0.0]),
        ("bias", [0.3, 0.25, 0.0]),
        ("bias", [0.8, 0.7, 0.0]),
        ("gain", [0.3, 0.25, 0.0]),
        ("gain", [0.8, 0.7, 0.0]),
        ("pseudo_angle", [1.0, 0.0, 0.0]),
        ("pseudo_angle", [1.0, 1.0, 0.0]),
        ("pseudo_angle", [-1.0, 2.0, 0.0]),
        ("pseudo_angle", [-3.0, -1.0, 0.0]),
        ("pseudo_angle", [2.0, -5.0, 0.0]),
        ("ring_noise", [13.0, 24.0, 5.0]),
        ("ring_noise", [10.0, 20.0, 7.5]),
        ("ring_noise", [-40.0, 3.0, 33.0]),
    ];
    for x in [
        0.0,
        0.5,
        1.0,
        std::f64::consts::FRAC_PI_2,
        2.0,
        3.0,
        -1.25,
        10.0,
        100.5,
        -1000.25,
        12345.678,
    ] {
        v.push(("psin", [x, 0.0, 0.0]));
        v.push(("pcos", [x, 0.0, 0.0]));
    }
    for i in [1.0, 3.0, 5.0, 11.0] {
        v.push(("unit_dir.x", [i, 16.0, 0.0]));
        v.push(("unit_dir.z", [i, 16.0, 0.0]));
    }
    for x in [0.0, 0.5, -0.5, 1.25, 10.7, -20.3, 100.123, -1074.5, 1023.9] {
        v.push(("exp2_p", [x, 0.0, 0.0]));
    }
    for x in [
        1.0,
        2.0,
        0.75,
        3.0,
        1e-300,
        5e-324,
        1234.5678,
        std::f64::consts::SQRT_2,
        1.5,
    ] {
        v.push(("log2_p", [x, 0.0, 0.0]));
    }
    // Signed zeros and NaN: the tie and NaN rules of `MinMax`, and the
    // functions that clamp with it, give one answer on every platform.
    let nan = f64::NAN;
    v.extend([
        ("fmax", [-0.0, 0.0, 0.0]),
        ("fmax", [0.0, -0.0, 0.0]),
        ("fmin", [0.0, -0.0, 0.0]),
        ("fmin", [-0.0, 0.0, 0.0]),
        ("fmax", [nan, 1.0, 0.0]),
        ("fmax", [1.0, nan, 0.0]),
        ("fmin", [nan, -2.0, 0.0]),
        ("fmin", [-2.0, nan, 0.0]),
        ("clamp01", [-0.0, 0.0, 0.0]),
        ("clamp01", [nan, 0.0, 0.0]),
        ("pow_smooth", [-0.0, 1.0, 0.0]),
        ("pow_smooth_d", [-0.0, 1.5, 0.0]),
        ("soft_down", [-0.0, 0.0, 1.0]),
        ("soft_down", [0.5, -0.0, 1.0]),
        ("smin", [-0.0, 0.0, 0.0]),
        ("smoothstep", [-0.0, 1.0, -0.0]),
        ("smoothstep_d", [1.0, 1.0, 1.0]),
        ("smootherstep_d", [1.0, 1.0, 2.0]),
    ]);
    v
}

const MATH_PINS: &[u64] = &[
    0x0000000000000000, // clamp01[-0.5, 0.0, 0.0] = 0e0
    0x3fd7ae147ae147ae, // clamp01[0.37, 0.0, 0.0] = 3.7e-1
    0x400c000000000000, // lerp[2.0, 7.0, 0.3] = 3.5e0
    0x3ff428f5c28f5c28, // smoothstep_d[0.0, 1.0, 0.3] = 1.2599999999999998e0
    0x3fd907f6e5d4c3b1, // smoothstep_d[2.0, 5.0, 4.2] = 3.91111111111111e-1
    0x3ff52b020c49ba5e, // smootherstep_d[0.0, 1.0, 0.3] = 1.323e0
    0x3fd87990b3366fb3, // smootherstep_d[2.0, 5.0, 4.2] = 3.824197530864197e-1
    0x0000000000000000, // soft_ramp[-1.0, 6.0, 0.0] = 0e0
    0x3fe0aaaaaaaaaaab, // soft_ramp[2.5, 6.0, 0.0] = 5.208333333333334e-1
    0x4018000000000000, // soft_ramp[9.0, 6.0, 0.0] = 6e0
    0x3fdaaaaaaaaaaaab, // soft_ramp_d[2.5, 6.0, 0.0] = 4.166666666666667e-1
    0x3fe0000000000000, // soft_down_d[10.0, 7.0, 6.0] = 5e-1
    0x3fe0000000000000, // soft_up_d[7.0, 10.0, 6.0] = 5e-1
    0x3fe92b3ad80863bd, // soft_ceiling_d[470.0, 450.0, 498.0] = 7.865270823850704e-1
    0x3fe2cf2307791f71, // psin_turns[0.1, 0.0, 0.0] = 5.877852579078376e-1
    0x3fee6f0e1311efce, // psin_turns[-3.7, 0.0, 0.0] = 9.510565159284796e-1
    0x3fcba5e353f7ced9, // smoothstep[0.0, 1.0, 0.3] = 2.16e-1
    0x3fea63100136b070, // smoothstep[2.0, 5.0, 4.2] = 8.245925925925928e-1
    0x3fc4dfce3150dae5, // smootherstep[0.0, 1.0, 0.3] = 1.6308000000000003e-1
    0x3fec19a6ef09dc19, // smootherstep[2.0, 5.0, 4.2] = 8.781313580246916e-1
    0x401c000000000000, // soft_down[10.0, 4.0, 6.0] = 7e0
    0x4022800000000000, // soft_down[10.0, 7.0, 6.0] = 9.25e0
    0x4024000000000000, // soft_down[10.0, 12.0, 6.0] = 1e1
    0x4015fd70a3d70a3e, // soft_down[5.5, 5.4, 2.0] = 5.4975000000000005e0
    0x405a000000000000, // soft_down[137.25, 101.5, 5.0] = 1.04e2
    0x401c000000000000, // soft_up[4.0, 10.0, 6.0] = 7e0
    0x401f000000000000, // soft_up[7.0, 10.0, 6.0] = 7.75e0
    0x4028000000000000, // soft_up[12.0, 10.0, 6.0] = 1.2e1
    0x40561ac000000000, // soft_up[88.125, 90.0, 6.0] = 8.841796875e1
    0x3ff0000000000000, // smin[1.0, 2.0, 0.5] = 1e0
    0x3fee8f5c28f5c28f, // smin[1.0, 1.2, 0.5] = 9.55e-1
    0xc009cccccccccccd, // smin[-3.0, 4.0, 10.0] = -3.225e0
    0x3ff3eb851eb851eb, // smax[1.0, 1.2, 0.5] = 1.2449999999999999e0
    0x4010e66666666666, // smax[-3.0, 4.0, 10.0] = 4.225e0
    0x4079000000000000, // soft_ceiling[400.0, 450.0, 498.0] = 4e2
    0x407d476276276276, // soft_ceiling[470.0, 450.0, 498.0] = 4.6846153846153845e2
    0x407f1ffffff124aa, // soft_ceiling[1000000.0, 450.0, 498.0] = 4.979999999446542e2
    0x3fc93e1bd7b001d7, // pow_smooth[0.3, 1.35, 0.0] = 1.9720790893189985e-1
    0x3fc52001f244c748, // pow_smooth[0.5, 2.6, 0.0] = 1.6503929452442834e-1
    0x3fea4dc3f714495c, // pow_smooth[0.77, 0.75, 0.0] = 8.219928575293056e-1
    0x3f94219d8b5f8681, // pow_smooth[0.123, 1.875, 0.0] = 1.965948260465789e-2
    0x3fe9614b3c92acec, // pow_smooth[0.9, 2.2, 0.0] = 7.931266959252787e-1
    0x0000000000000000, // pow_smooth[0.0, 1.5, 0.0] = 0e0
    0x3fe753f7ced91688, // pow_smooth[0.9, 3.0, 0.0] = 7.290000000000001e-1
    0x3febed4c7aaf0fbe, // pow_smooth[0.25, 0.1, 0.0] = 8.727171322029716e-1
    0x3fd3d5695eb5e8d7, // pow_smooth[0.64, 2.625, 0.0] = 3.099006104381607e-1
    0x3fec54ee3fe30a60, // pow_smooth_d[0.3, 1.35, 0.0] = 8.85367512492234e-1
    0x3feb719a2cb24802, // pow_smooth_d[0.5, 2.6, 0.0] = 8.576174614884169e-1
    0x3fd32e135e271bda, // pow_smooth_d[0.123, 1.875, 0.0] = 2.996872348271019e-1
    0x0000000000000000, // pow_smooth_d[0.0, 1.5, 0.0] = 0e0
    0x400370a3d70a3d71, // pow_smooth_d[0.9, 3.0, 0.0] = 2.43e0
    0x3ff0000000000000, // pow_smooth_d[0.5, 1.0, 0.0] = 1e0
    0x3ff50e3a34eceaf6, // pow_smooth_d[0.93, 1.35, 0.0] = 1.315973479023055e0
    0x3fc0000000000000, // bias[0.3, 0.25, 0.0] = 1.25e-1
    0x3fece739ce739ce7, // bias[0.8, 0.7, 0.0] = 9.032258064516129e-1
    0x3fc5555555555555, // gain[0.3, 0.25, 0.0] = 1.6666666666666666e-1
    0x3fe642c8590b2164, // gain[0.8, 0.7, 0.0] = 6.956521739130435e-1
    0x0000000000000000, // pseudo_angle[1.0, 0.0, 0.0] = 0e0
    0x3fe0000000000000, // pseudo_angle[1.0, 1.0, 0.0] = 5e-1
    0x3ff5555555555555, // pseudo_angle[-1.0, 2.0, 0.0] = 1.3333333333333333e0
    0x4002000000000000, // pseudo_angle[-3.0, -1.0, 0.0] = 2.25e0
    0x400a492492492492, // pseudo_angle[2.0, -5.0, 0.0] = 3.2857142857142856e0
    0xc029cccccccccccb, // ring_noise[13.0, 24.0, 5.0] = -1.2899999999999997e1
    0xc021800000000000, // ring_noise[10.0, 20.0, 7.5] = -8.75e0
    0xc029dfcb2ec4bf70, // ring_noise[-40.0, 3.0, 33.0] = -1.2937097035901132e1
    0x0000000000000000, // psin[0.0, 0.0, 0.0] = 0e0
    0x3fefffffffffffff, // pcos[0.0, 0.0, 0.0] = 9.999999999999999e-1
    0x3fdeaee875b85813, // psin[0.5, 0.0, 0.0] = 4.794255399332325e-1
    0x3fec1528030e7370, // pcos[0.5, 0.0, 0.0] = 8.775825557419079e-1
    0x3feaed548ca43910, // psin[1.0, 0.0, 0.0] = 8.414709803489888e-1
    0x3fe14a2811e3eabf, // pcos[1.0, 0.0, 0.0] = 5.403023099346099e-1
    0x3fefffffffffffff, // psin[1.5707963267948966, 0.0, 0.0] = 9.999999999999999e-1
    0x0000000000000000, // pcos[1.5707963267948966, 0.0, 0.0] = 0e0
    0x3fed18f6e7c60127, // psin[2.0, 0.0, 0.0] = 9.092974211526198e-1
    0xbfdaa22655843084, // pcos[2.0, 0.0, 0.0] = -4.1614683486182735e-1
    0x3fc2103862e40bc7, // psin[3.0, 0.0, 0.0] = 1.4112000301983427e-1
    0xbfefae04c1cdea50, // pcos[3.0, 0.0, 0.0] = -9.899925027123775e-1
    0xbfee5e14fda73b93, // psin[-1.25, 0.0, 0.0] = -9.489846185841649e-1
    0x3fd42e3dd2ddb76e, // pcos[-1.25, 0.0, 0.0] = 3.153223571051659e-1
    0xbfe1689ef8363fbc, // psin[10.0, 0.0, 0.0] = -5.440211151017063e-1
    0xbfead9ac86bddba5, // pcos[10.0, 0.0, 0.0] = -8.390715247795596e-1
    0xbf9fb3f81d6f997f, // psin[100.5, 0.0, 0.0] = -3.0959965511919926e-2
    0x3feffc12ae2714e4, // pcos[100.5, 0.0, 0.0] = 9.995206262034597e-1
    0xbfee170232fde5c9, // psin[-1000.25, 0.0, 0.0] = -9.40308665841422e-1
    0x3fd5c7d943aeee42, // pcos[-1000.25, 0.0, 0.0] = 3.403227959604217e-1
    0xbfe687d58bb20ff4, // psin[12345.678, 0.0, 0.0] = -7.040813187054469e-1
    0x3fe6b94c3e4428b3, // pcos[12345.678, 0.0, 0.0] = 7.101193634164445e-1
    0x3fed906bcf328d46, // unit_dir.x[1.0, 16.0, 0.0] = 9.238795325112867e-1
    0x3fd87de2a6aea963, // unit_dir.z[1.0, 16.0, 0.0] = 3.826834323650898e-1
    0x3fd87de2a6aea963, // unit_dir.x[3.0, 16.0, 0.0] = 3.826834323650898e-1
    0x3fed906bcf328d46, // unit_dir.z[3.0, 16.0, 0.0] = 9.238795325112867e-1
    0xbfd87de2a6aea963, // unit_dir.x[5.0, 16.0, 0.0] = -3.826834323650898e-1
    0x3fed906bcf328d46, // unit_dir.z[5.0, 16.0, 0.0] = 9.238795325112867e-1
    0xbfd87de2a6aea963, // unit_dir.x[11.0, 16.0, 0.0] = -3.826834323650898e-1
    0xbfed906bcf328d46, // unit_dir.z[11.0, 16.0, 0.0] = -9.238795325112867e-1
    0x3ff0000000000000, // exp2_p[0.0, 0.0, 0.0] = 1e0
    0x3ff6a09e667f3bcc, // exp2_p[0.5, 0.0, 0.0] = 1.414213562373095e0
    0x3fe6a09e667f3bcc, // exp2_p[-0.5, 0.0, 0.0] = 7.071067811865475e-1
    0x400306fe0a31b715, // exp2_p[1.25, 0.0, 0.0] = 2.378414230005442e0
    0x4099fdf8bcce533a, // exp2_p[10.7, 0.0, 0.0] = 1.6634929077375696e3
    0x3ea9fdf8bcce533a, // exp2_p[-20.3, 0.0, 0.0] = 7.74624248844371e-7
    0x46316c882264f697, // exp2_p[100.123, 0.0, 0.0] = 1.38046772013757e30
    0x0000000000000001, // exp2_p[-1074.5, 0.0, 0.0] = 5e-324
    0x7feddb680117aa8e, // exp2_p[1023.9, 0.0, 0.0] = 1.6773070034857416e308
    0x0000000000000000, // log2_p[1.0, 0.0, 0.0] = 0e0
    0x3ff0000000000000, // log2_p[2.0, 0.0, 0.0] = 1e0
    0xbfda8ff971810a5d, // log2_p[0.75, 0.0, 0.0] = -4.1503749927884376e-1
    0x3ff95c01a39fbd69, // log2_p[3.0, 0.0, 0.0] = 1.5849625007211563e0
    0xc08f24a09f1a8b89, // log2_p[1e-300, 0.0, 0.0] = -9.965784284662087e2
    0xc090c80000000000, // log2_p[5e-324, 0.0, 0.0] = -1.074e3
    0x40248a21f60ffaf4, // log2_p[1234.5678, 0.0, 0.0] = 1.0269790353251189e1
    0x3fe0000000000001, // log2_p[1.4142135623730951, 0.0, 0.0] = 5.000000000000001e-1
    0x3fe2b803473f7ad2, // log2_p[1.5, 0.0, 0.0] = 5.849625007211563e-1
    0x0000000000000000, // fmax[-0.0, 0.0, 0.0] = 0e0
    0x8000000000000000, // fmax[0.0, -0.0, 0.0] = -0e0
    0x8000000000000000, // fmin[0.0, -0.0, 0.0] = -0e0
    0x0000000000000000, // fmin[-0.0, 0.0, 0.0] = 0e0
    0x3ff0000000000000, // fmax[NaN, 1.0, 0.0] = 1e0
    0x3ff0000000000000, // fmax[1.0, NaN, 0.0] = 1e0
    0xc000000000000000, // fmin[NaN, -2.0, 0.0] = -2e0
    0xc000000000000000, // fmin[-2.0, NaN, 0.0] = -2e0
    0x0000000000000000, // clamp01[-0.0, 0.0, 0.0] = 0e0
    0x0000000000000000, // clamp01[NaN, 0.0, 0.0] = 0e0
    0x0000000000000000, // pow_smooth[-0.0, 1.0, 0.0] = 0e0
    0x0000000000000000, // pow_smooth_d[-0.0, 1.5, 0.0] = 0e0
    0x8000000000000000, // soft_down[-0.0, 0.0, 1.0] = -0e0
    0x3fd8000000000000, // soft_down[0.5, -0.0, 1.0] = 3.75e-1
    0x0000000000000000, // smin[-0.0, 0.0, 0.0] = 0e0
    0x0000000000000000, // smoothstep[-0.0, 1.0, -0.0] = 0e0
    0x0000000000000000, // smoothstep_d[1.0, 1.0, 1.0] = 0e0
    0x0000000000000000, // smootherstep_d[1.0, 1.0, 2.0] = 0e0
];

#[test]
#[ignore = "regenerates the pin table"]
fn print_math_pins() {
    let inputs = pin_inputs();
    println!("const MATH_PINS: &[u64] = &[");
    for (name, a) in &inputs {
        let v = eval_pin(name, *a);
        println!("    0x{:016x}, // {name}{a:?} = {v:e}", v.to_bits());
    }
    println!("];");
}

#[test]
fn math_golden_pins_hold_with_their_error_bounds() {
    let inputs = pin_inputs();
    assert_eq!(
        inputs.len(),
        MATH_PINS.len(),
        "pin table out of date: run print_math_pins"
    );
    for ((name, a), &bits) in inputs.iter().zip(MATH_PINS) {
        let v = eval_pin(name, *a);
        assert_eq!(
            v.to_bits(),
            bits,
            "{name}{a:?} drifted: {v:e} vs {:e}",
            f64::from_bits(bits)
        );
        if let Some((r, bound)) = reference(name, *a) {
            assert!(
                (v - r).abs() <= bound,
                "{name}{a:?} = {v:e}, reference {r:e}, error above {bound:e}"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Math: error bounds and properties over dense and random inputs.

#[test]
fn psin_and_pcos_stay_within_their_bound() {
    let mut worst: f64 = 0.0;
    let mut stream = HashStream::new(0x5175);
    let mut xs: Vec<f64> = (0..200_001)
        .map(|i| -20.0 + 40.0 * i as f64 / 200_000.0)
        .collect();
    xs.extend((0..20_000).map(|_| stream.range_f((-1.0e4, 1.0e4))));
    for x in xs {
        worst = worst
            .max((psin(x) - x.sin()).abs())
            .max((pcos(x) - x.cos()).abs());
        assert!(psin(x).abs() <= 1.0 && pcos(x).abs() <= 1.0);
    }
    println!("psin/pcos max error {worst:e}");
    assert!(worst <= 2e-7, "psin/pcos error {worst:e}");
    assert_eq!(psin(0.0).to_bits(), 0.0f64.to_bits());
}

#[test]
fn exp2_and_log2_stay_within_their_bound() {
    let mut stream = HashStream::new(0xe2);
    let mut worst_exp: f64 = 0.0;
    let mut worst_log: f64 = 0.0;
    for _ in 0..100_000 {
        let x = stream.range_f((-60.0, 60.0));
        worst_exp = worst_exp.max(((exp2_p(x) - x.exp2()) / x.exp2()).abs());
        let y = stream.range_f((1e-6, 1e6));
        worst_log = worst_log.max((log2_p(y) - y.log2()).abs() / y.log2().abs().max(1.0));
    }
    println!("exp2_p max relative error {worst_exp:e}, log2_p {worst_log:e}");
    assert!(worst_exp <= 1e-15 && worst_log <= 1e-15);
    assert_eq!(exp2_p(3.0), 8.0);
    assert_eq!(log2_p(1024.0), 10.0);
    assert_eq!(log2_p(0.0), f64::NEG_INFINITY);
    assert!(log2_p(-1.0).is_nan());
}

#[test]
fn pow_smooth_is_exact_at_eighths_monotone_and_continuous_in_e() {
    let mut stream = HashStream::new(0x9051);
    for _ in 0..20_000 {
        let t = stream.unit();
        let (r2, r4, r8) = (t.sqrt(), t.sqrt().sqrt(), t.sqrt().sqrt().sqrt());
        assert_eq!(pow_smooth(t, 2.0).to_bits(), (t * t).to_bits());
        assert_eq!(pow_smooth(t, 0.5).to_bits(), r2.to_bits());
        assert_eq!(pow_smooth(t, 1.5).to_bits(), (t * r2).to_bits());
        assert_eq!(pow_smooth(t, 2.625).to_bits(), (t * t * r2 * r8).to_bits());
        assert_eq!(pow_smooth(t, 1.25).to_bits(), (t * r4).to_bits());
        assert_eq!(pow_smooth_d(t, 2.0).to_bits(), (2.0 * t).to_bits());
        assert_eq!(pow_smooth_d(t, 1.5).to_bits(), (1.5 * r2).to_bits());
        assert_eq!(pow_smooth_d(t, 1.0).to_bits(), 1.0f64.to_bits());
        assert_eq!(pow_smooth_d(t, 3.0).to_bits(), (3.0 * (t * t)).to_bits());
        // Continuous in e across an eighth.
        let e = (stream.range_i((8, 40)) as f64) / 8.0;
        assert!((pow_smooth(t, e - 1e-12) - pow_smooth(t, e)).abs() < 1e-10);
        assert!((pow_smooth(t, e + 1e-12) - pow_smooth(t, e)).abs() < 1e-10);
    }
    // The paired form is the same bits as the two calls.
    for _ in 0..20_000 {
        let (t, e) = (stream.range_f((-0.1, 1.2)), stream.range_f((0.0, 9.0)));
        let (v, d) = pow_smooth_vd(t, e);
        assert_eq!(
            (v.to_bits(), d.to_bits()),
            (pow_smooth(t, e).to_bits(), pow_smooth_d(t, e).to_bits())
        );
    }
    // Monotone in t, bit for bit, for any exponent.
    for e in [0.75, 1.0, 1.35, 1.875, 2.6, 4.3] {
        let mut prev = -1.0;
        for i in 0..=100_000 {
            let v = pow_smooth(i as f64 / 100_000.0, e);
            assert!(v >= prev, "pow_smooth(·, {e}) decreased at step {i}");
            prev = v;
        }
    }
}

#[test]
fn pow_smooth_d_matches_a_central_difference() {
    let mut stream = HashStream::new(0xd1ff);
    let mut worst: f64 = 0.0;
    for _ in 0..50_000 {
        let t = stream.range_f((0.05, 1.0));
        let e = stream.range_f((1.0, 4.0));
        let h = 1e-6;
        let numeric = (pow_smooth(t + h, e) - pow_smooth(t - h, e)) / (2.0 * h);
        worst = worst.max((pow_smooth_d(t, e) - numeric).abs());
    }
    println!("pow_smooth_d vs central difference: max {worst:e}");
    assert!(
        worst <= 1e-9,
        "pow_smooth_d differs from its central difference by {worst:e}"
    );
    assert_eq!(pow_smooth_d(0.0, 1.35), 0.0);
}

fn random_ground(stream: &mut HashStream) -> (f64, f64, f64) {
    let cur = stream.range_f((-300.0, 600.0));
    let k = stream.range_f((0.0, 12.0));
    let h = cur + stream.range_f((-40.0, 40.0));
    (cur, h, k)
}

#[test]
fn soft_clamps_are_the_identity_where_the_target_does_not_ask_to_move() {
    let mut stream = HashStream::new(0x1d);
    for _ in 0..200_000 {
        let (cur, h, k) = random_ground(&mut stream);
        if h >= cur {
            assert_eq!(
                soft_down(cur, h, k).to_bits(),
                cur.to_bits(),
                "soft_down({cur}, {h}, {k})"
            );
        }
        if h <= cur {
            assert_eq!(
                soft_up(cur, h, k).to_bits(),
                cur.to_bits(),
                "soft_up({cur}, {h}, {k})"
            );
        }
        assert_eq!(soft_down(cur, cur, k).to_bits(), cur.to_bits());
        assert_eq!(soft_up(cur, cur, k).to_bits(), cur.to_bits());
    }
    for z in [0.0f64, -0.0] {
        assert_eq!(soft_down(z, z, 3.0).to_bits(), z.to_bits());
        assert_eq!(soft_up(z, z, 3.0).to_bits(), z.to_bits());
    }
}

#[test]
fn soft_clamps_engage_at_exactly_half_k() {
    let mut stream = HashStream::new(0xe9);
    for _ in 0..100_000 {
        let h = stream.range_f((-300.0, 600.0));
        let k = stream.range_f((0.0, 12.0));
        let cur = h + k + stream.range_f((0.0, 50.0));
        assert_eq!(soft_down(cur, h, k).to_bits(), (h + 0.5 * k).to_bits());
        let below = h - k - stream.range_f((0.0, 50.0));
        assert_eq!(soft_up(below, h, k).to_bits(), (h - 0.5 * k).to_bits());
    }
}

#[test]
fn soft_clamps_are_monotone_and_c1() {
    let mut stream = HashStream::new(0x30);
    for _ in 0..2_000 {
        let h = stream.range_f((-300.0, 600.0));
        let k = stream.range_f((0.5, 12.0));
        // Bit-exact monotone in the ground, sweeping through both joins.
        let mut prev_down = f64::NEG_INFINITY;
        let mut prev_up = f64::NEG_INFINITY;
        for i in 0..=4_000 {
            let cur = h - 2.0 * k + 4.0 * k * i as f64 / 4_000.0;
            let (d, u) = (soft_down(cur, h, k), soft_up(cur, h, k));
            assert!(
                d >= prev_down && u >= prev_up,
                "not monotone at cur {cur}, h {h}, k {k}"
            );
            assert!(d >= h.min(cur) && d <= cur, "soft_down left [h, cur]");
            prev_down = d;
            prev_up = u;
        }
        // Monotone in the target, to rounding.
        let cur = h + stream.range_f((-2.0 * k, 2.0 * k));
        let mut prev = f64::NEG_INFINITY;
        for i in 0..=4_000 {
            let target = cur - 2.0 * k + 4.0 * k * i as f64 / 4_000.0;
            let v = soft_down(cur, target, k);
            assert!(v >= prev - 1e-12 * cur.abs().max(1.0));
            prev = v;
        }
        // C1: the slope is continuous at both joins, and the analytic slope
        // matches the numeric one.
        for d in [0.0, k] {
            let (lo, hi) = (h + d - 1e-9, h + d + 1e-9);
            assert!((soft_down_d(lo, h, k) - soft_down_d(hi, h, k)).abs() < 1e-6);
            assert!((soft_up_d(2.0 * h - lo, h, k) - soft_up_d(2.0 * h - hi, h, k)).abs() < 1e-6);
            assert!((soft_down(lo, h, k) - soft_down(hi, h, k)).abs() < 1e-8);
        }
        let cur = h + stream.range_f((0.01, 0.99)) * k;
        let numeric = (soft_down(cur + 1e-6, h, k) - soft_down(cur - 1e-6, h, k)) / 2e-6;
        assert!((numeric - soft_down_d(cur, h, k)).abs() < 1e-6);
    }
}

#[test]
fn smooth_extrema_ceiling_bias_and_gain_behave() {
    let mut stream = HashStream::new(0x5e);
    for _ in 0..50_000 {
        let (a, b) = (stream.range_f((-50.0, 50.0)), stream.range_f((-50.0, 50.0)));
        let k = stream.range_f((0.1, 10.0));
        assert!(smin(a, b, k) <= a.min(b) && smax(a, b, k) >= a.max(b));
        assert_eq!(smin(a, b, k).to_bits(), smin(b, a, k).to_bits());
        if (a - b).abs() >= k {
            assert_eq!(smin(a, b, k), a.min(b));
        }
        let t = stream.unit();
        let g = stream.range_f((0.05, 0.95));
        assert!((bias(bias(t, g), 1.0 - g) - t).abs() < 1e-12);
        assert!((gain(gain(t, g), 1.0 - g) - t).abs() < 1e-12);
    }
    // The soft ceiling: slope 1 at the knee, monotone, under the cap.
    let (knee, cap) = (450.0, 498.0);
    assert!((soft_ceiling_d(knee + 1e-9, knee, cap) - 1.0).abs() < 1e-12);
    let mut prev = f64::NEG_INFINITY;
    for i in 0..100_000 {
        let h = 300.0 + i as f64 * 0.01;
        let v = soft_ceiling(h, knee, cap);
        assert!(v >= prev && v < cap);
        prev = v;
    }
}

#[test]
fn pseudo_angle_is_monotone_in_the_true_angle() {
    let mut prev = -1.0;
    for i in 0..65_536 {
        let a = std::f64::consts::TAU * i as f64 / 65_536.0;
        let p = pseudo_angle(a.cos(), a.sin());
        assert!((0.0..4.0).contains(&p));
        assert!(p >= prev, "pseudo_angle not monotone at {a}");
        prev = p;
    }
    assert_eq!(pseudo_angle(0.0, 0.0), 0.0);
    assert_eq!(pseudo_angle(0.0, 1.0), 1.0);
    assert_eq!(pseudo_angle(-1.0, 0.0), 2.0);
    assert_eq!(pseudo_angle(0.0, -1.0), 3.0);
}

#[test]
fn unit_dir_and_ring_noise() {
    for n in [8u32, 16, 32] {
        for i in 0..n as i64 {
            let (c, s) = unit_dir(i, n);
            let a = std::f64::consts::TAU * i as f64 / n as f64;
            assert!((c - a.cos()).abs() <= 1e-15 && (s - a.sin()).abs() <= 1e-15);
        }
    }
    // Ring noise reads the field on the ring, constant along each ray.
    let field = |x: f64, z: f64| psin(0.37 * x) + pcos(0.21 * z);
    let c = (5.0, -3.0);
    for i in 1..50 {
        let p = (c.0 + 0.3 * i as f64, c.1 + 0.4 * i as f64);
        let v = ring_noise(field, c, p, 10.0);
        assert!((v - field(c.0 + 6.0, c.1 + 8.0)).abs() < 1e-12);
    }
}

#[test]
fn step_derivatives_match_central_differences() {
    let mut stream = HashStream::new(0x57e9);
    for _ in 0..20_000 {
        let (e0, e1) = (stream.range_f((-5.0, 5.0)), stream.range_f((6.0, 20.0)));
        let x = stream.range_f((e0, e1));
        let h = 1e-6;
        let ns = (smoothstep(e0, e1, x + h) - smoothstep(e0, e1, x - h)) / (2.0 * h);
        let nq = (smootherstep(e0, e1, x + h) - smootherstep(e0, e1, x - h)) / (2.0 * h);
        assert!((ns - smoothstep_d(e0, e1, x)).abs() < 1e-7);
        assert!((nq - smootherstep_d(e0, e1, x)).abs() < 1e-7);
    }
}

// ---------------------------------------------------------------------------
// Profiles.

fn faces() -> Vec<Face> {
    [
        FaceSpec {
            h: 60.0,
            ledge: 25.0,
            run1: 2.5,
            shelf: 3.0,
            run2: 3.5,
            rim: 5.0,
        },
        FaceSpec {
            h: 30.0,
            ledge: 10.0,
            run1: 1.3,
            shelf: 0.0,
            run2: 2.0,
            rim: 3.0,
        },
        FaceSpec {
            h: 90.0,
            ledge: 50.0,
            run1: 6.5,
            shelf: 4.5,
            run2: 4.4,
            rim: 7.0,
        },
    ]
    .into_iter()
    .map(|s| Face::new(s).expect("valid face"))
    .collect()
}

fn slots() -> Vec<SlotSection> {
    [
        SlotSpec {
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
        },
        SlotSpec {
            depth: 12.0,
            half: 1.6,
            flat: 0.85,
            ledge: None,
            lip: 1.0,
            lip_reach: 3.0,
            bench: 3.0,
            bench_reach: 9.0,
        },
        SlotSpec {
            depth: 30.0,
            half: 3.0,
            flat: 0.6,
            ledge: Some(SlotLedge {
                width: 1.5,
                depth_share: 0.5,
                run: 2.0,
            }),
            lip: 3.0,
            lip_reach: 4.0,
            bench: 1.0,
            bench_reach: 4.0,
        },
    ]
    .into_iter()
    .map(|s| SlotSection::new(s).expect("valid slot"))
    .collect()
}

/// Walls under test: (exp, foot_round, rim_round). The canyon recipe and
/// its ±30% (clamped at 1), the exponents just above 1 whose power curve
/// alone would meet the floor at a slope, an empty body, and the extremes.
const WALLS: [(f64, f64, f64); 10] = [
    (1.35, 0.07, 0.07),
    (1.755, 0.1, 0.07),
    (1.0, 0.07, 0.2),
    (1.02, 0.07, 0.07),
    (1.05, 0.04, 0.07),
    (1.1, 0.07, 0.1),
    (1.124, 0.02, 0.07),
    (2.4, 0.05, 0.15),
    (1.5, 0.6, 0.4),
    (8.0, 0.2, 0.5),
];

/// Every monotone profile under test, by name.
fn monotone_profiles() -> Vec<(String, Box<dyn Monotone>)> {
    let mut out: Vec<(String, Box<dyn Monotone>)> = Vec::new();
    for (e, f, s) in WALLS {
        out.push((
            format!("Wall({e}, {f}, {s})"),
            Box::new(Wall::new(e, f, s).unwrap()),
        ));
    }
    for (e, s) in [(1.875, 0.94), (1.9, 0.9), (1.0, 0.5), (3.0, 0.8)] {
        out.push((
            format!("Cone({e}, {s})"),
            Box::new(Cone::new(e, s).unwrap()),
        ));
    }
    for (i, f) in faces().into_iter().enumerate() {
        out.push((format!("Face#{i}"), Box::new(f)));
    }
    for (s, k) in [(0.42, 0.0), (0.42, 0.1), (0.5, -0.1875), (1.0, 0.05)] {
        out.push((
            format!("SWall({s}, {k})"),
            Box::new(SWall::new(s, k).unwrap()),
        ));
    }
    for (i, s) in slots().into_iter().enumerate() {
        out.push((format!("Slot#{i}"), Box::new(s)));
    }
    out
}

fn assert_joins_c1(name: &str, p: &dyn Profile) {
    for i in 0..p.knot_count() {
        let k = p.knot(i);
        let (lv, ls) = p.piece(i, k);
        let (rv, rs) = p.piece(i + 1, k);
        assert!(
            (lv - rv).abs() <= 1e-12,
            "{name}: value jump {:e} at knot {i} ({k})",
            (lv - rv).abs()
        );
        assert!(
            (ls - rs).abs() <= 1e-12,
            "{name}: slope jump {:e} at knot {i} ({k})",
            (ls - rs).abs()
        );
    }
}

#[test]
fn profile_joins_are_c1() {
    for (name, p) in monotone_profiles() {
        assert_joins_c1(&name, p.as_ref());
    }
    for s in [0.72, 0.7, 0.5] {
        assert_joins_c1(&format!("DuneWave({s})"), &DuneWave::new(s).unwrap());
    }
}

#[test]
fn profiles_are_level_where_they_meet_their_surroundings() {
    for (name, p) in monotone_profiles() {
        let (lo, hi) = p.domain();
        // Every profile tops out level; all but the sea-cliff face (which
        // rises from the water) and the exponent-1 cone (which the build
        // clamp rounds into the plain) also start level. Walls start level
        // at every exponent: their foot is its own piece.
        assert!(
            p.sample(hi).1.abs() <= 1e-12,
            "{name}: slope {:e} at its top",
            p.sample(hi).1
        );
        if !name.starts_with("Face") && !name.starts_with("Cone(1,") {
            assert!(
                p.sample(lo).1.abs() <= 1e-12,
                "{name}: slope {:e} at its foot",
                p.sample(lo).1
            );
        }
    }
}

/// Steepest slope of `p` on `[a, b]`, and whether its slope ever rises
/// (`rising`) or falls (`!rising`) by more than `tol` between samples.
fn slope_trend(p: &dyn Profile, a: f64, b: f64, rising: bool, tol: f64) -> Option<(f64, f64)> {
    let n = 4_000;
    let mut prev = p.slope(a);
    for i in 1..=n {
        let u = a + (b - a) * i as f64 / n as f64;
        let s = p.slope(u);
        let wrong = if rising {
            s < prev - tol
        } else {
            s > prev + tol
        };
        if wrong {
            return Some((u, s - prev));
        }
        prev = s;
    }
    None
}

#[test]
fn wall_feet_round_off_the_floor_at_every_exponent() {
    // pow_smooth's own slope at 0 is 1 − 8(exp − 1) below exp 9/8, and its
    // slope climbs steeply just above 0 for exponents near 1: a wall built
    // on it alone meets the floor with a crease. The foot piece rounds it.
    for (e, f, s) in WALLS {
        let wall = Wall::new(e, f, s).unwrap();
        let name = format!("Wall({e}, {f}, {s})");
        assert_eq!(wall.slope(0.0), 0.0, "{name}: level at the foot");
        assert!(
            slope_trend(&wall, 0.0, wall.knot(1), true, 1e-12).is_none(),
            "{name}: the slope falls somewhere between foot and rim"
        );
        // Curvature at the foot is bounded: the slope reaches the body's
        // slope over the whole foot, not in a sliver of it.
        let reach = wall.slope(f * 0.5) / wall.slope(f);
        assert!(
            (reach - 0.5).abs() < 1e-9,
            "{name}: the foot's slope rises linearly ({reach})"
        );
    }
    for e in [1.0, 1.01, 1.05, 1.1, 1.12, 1.124_999] {
        assert!(
            pow_smooth_d(0.0, e) > 0.0,
            "the bare power is creased at {e}"
        );
        let wall = Wall::new(e, 0.07, 0.07).unwrap();
        assert_eq!(wall.slope(0.0), 0.0);
    }
}

#[test]
fn rims_round_over_without_steepening() {
    // From the last join to the top, the slope only falls: a rim rolls
    // over, it never bulges out before it does.
    for (name, p) in monotone_profiles() {
        if name.starts_with("SWall") {
            // An S-wall's last piece is the whole wall, rising and falling.
            continue;
        }
        let last = p.knot_count() - 1;
        let (_, hi) = p.domain();
        let scale = p.slope(p.knot(last)).abs().max(1.0);
        if let Some((u, d)) = slope_trend(p.as_ref(), p.knot(last), hi, false, 1e-12 * scale) {
            panic!("{name}: the slope rises by {d:e} at {u} past the rim's join");
        }
    }
    // A wall is steepest exactly at the brink, where body meets rim.
    for (e, f, s) in WALLS {
        let wall = Wall::new(e, f, s).unwrap();
        let brink = wall.slope(wall.knot(1));
        let steepest = (0..=10_000)
            .map(|i| wall.slope(i as f64 / 10_000.0))
            .fold(0.0, f64::max);
        assert!(
            steepest <= brink * (1.0 + 1e-12),
            "Wall({e}, {f}, {s}): steepest {steepest} above the brink's {brink}"
        );
    }
}

#[test]
fn profiles_are_monotone_and_their_slopes_match_their_heights() {
    for (name, p) in monotone_profiles() {
        let (lo, hi) = p.domain();
        let scale = (p.height(hi) - p.height(lo)).abs().max(1.0);
        let mut prev = f64::NEG_INFINITY;
        let n = 20_000;
        let mut max_slope: f64 = 0.0;
        for i in 0..=n {
            let u = lo + (hi - lo) * i as f64 / n as f64;
            let (v, s) = p.sample(u);
            assert!(v >= prev - 1e-12 * scale, "{name}: height fell at u {u}");
            assert!(s >= -1e-12 * scale, "{name}: slope {s} at u {u}");
            prev = v;
            max_slope = max_slope.max(s);
        }
        let h = (hi - lo) * 1e-7;
        for i in 1..1_000 {
            let u = lo + (hi - lo) * (i as f64 + 0.37) / 1_000.0;
            if (0..p.knot_count()).any(|k| (p.knot(k) - u).abs() < 4.0 * h) {
                continue;
            }
            let numeric = (p.height(u + h) - p.height(u - h)) / (2.0 * h);
            let err = (numeric - p.slope(u)).abs();
            assert!(
                err <= 1e-5 * max_slope.max(1.0),
                "{name}: slope off by {err:e} at u {u}"
            );
        }
    }
}

#[test]
fn profile_inverses_round_trip() {
    let mut worst_u: f64 = 0.0;
    for (name, p) in monotone_profiles() {
        let (lo, hi) = p.domain();
        let (v_lo, v_hi) = (p.height(lo), p.height(hi));
        let n = 5_000;
        for i in 0..=n {
            let u = lo + (hi - lo) * i as f64 / n as f64;
            let (v, s) = p.sample(u);
            // Height → parameter → height, everywhere.
            let back = p.height(p.inverse(v));
            assert!(
                (back - v).abs() <= 1e-9 * (v_hi - v_lo).abs().max(1.0),
                "{name}: height {v} came back {back}"
            );
            // Parameter → height → parameter, wherever the profile is not
            // level (a level piece has no single inverse).
            if s > 1e-9 {
                let err = (p.inverse(v) - u).abs();
                worst_u = worst_u.max(err / (hi - lo));
                assert!(
                    err <= 1e-6 * (hi - lo),
                    "{name}: u {u} came back {}",
                    p.inverse(v)
                );
            }
        }
    }
    println!("profile inverse worst relative round trip {worst_u:e}");
}

#[test]
fn face_offset_is_its_inverse_and_infinite_above_the_top() {
    for f in faces() {
        let spec = f.spec();
        assert_eq!(f.offset(0.0), 0.0);
        assert_eq!(f.offset(spec.h + 1.0), f64::INFINITY);
        for i in 1..1000 {
            let v = spec.h * i as f64 / 1000.0;
            let sp = f.offset(v);
            assert!(
                (f.height(sp) - v).abs() < 1e-9,
                "offset({v}) = {sp}, height there {}",
                f.height(sp)
            );
        }
        assert!(f.steepest() > 1.0);
    }
}

#[test]
fn dune_wave_is_c1_across_the_wrap() {
    for s in [0.72, 0.7, 0.5] {
        let d = DuneWave::new(s).unwrap();
        let end = d.piece(1, 1.0);
        let start = d.piece(0, 0.0);
        assert!(end.0.abs() <= 1e-12 && end.1.abs() <= 1e-12);
        assert_eq!(start, (0.0, 0.0));
        let crest = d.sample(s);
        assert!((crest.0 - 1.0).abs() < 1e-15 && crest.1.abs() < 1e-12);
        let (a, b) = (d.sample(1.0 - 1e-9), d.sample(1e-9));
        assert!((a.0 - b.0).abs() < 1e-12 && (a.1 - b.1).abs() < 1e-6);
        for i in 0..100 {
            let u = i as f64 * 0.0137;
            let (p, q) = (d.sample(u), d.sample(u + 3.0));
            assert!((p.0 - q.0).abs() < 1e-12);
        }
        let (st, le) = d.inverse(0.4);
        assert!(st < s && le > s);
        assert!((d.sample(st).0 - 0.4).abs() < 1e-9 && (d.sample(le).0 - 0.4).abs() < 1e-9);
        assert!((d.max_lee_slope(90.0, 1400.0) - 1.5 * 90.0 / ((1.0 - s) * 1400.0)).abs() < 1e-15);
    }
}

#[test]
fn profiles_refuse_specs_that_would_overshoot_or_make_no_sense() {
    assert!(Wall::new(0.9, 0.07, 0.07).is_err());
    assert!(Wall::new(1.35, 0.07, 1.0).is_err());
    assert!(Wall::new(1.35, 0.0, 0.07).is_err(), "a wall needs a foot");
    assert!(Wall::new(1.35, 0.6, 0.5).is_err(), "foot and rim overlap");
    assert!(
        Cone::new(8.0, 1e-300).is_err(),
        "a cone too flat to normalise"
    );
    assert!(Cone::new(1.875, 0.0).is_err());
    assert!(SWall::new(0.42, 0.2).is_err());
    assert!(SWall::new(0.0, 0.0).is_err());
    assert!(DuneWave::new(1.0).is_err());
    // A face whose shelf ends above the cliff top.
    assert!(Face::new(FaceSpec {
        h: 20.0,
        ledge: 25.0,
        run1: 2.0,
        shelf: 3.0,
        run2: 2.0,
        rim: 3.0
    })
    .is_err());
    // A foot too gentle to climb to its ledge.
    assert!(Face::new(FaceSpec {
        h: 60.0,
        ledge: 1.0,
        run1: 20.0,
        shelf: 3.0,
        run2: 3.0,
        rim: 3.0
    })
    .is_err());
    let mut slot = slots()[0].spec();
    slot.ledge = Some(SlotLedge {
        width: 3.0,
        depth_share: 0.1,
        run: 0.8,
    });
    assert!(
        SlotSection::new(slot).is_err(),
        "a ledge above the rim's wear"
    );
    // A wall whose rim slope is steeper than the wall can climb monotonically.
    slot.ledge = Some(SlotLedge {
        width: 3.0,
        depth_share: 0.35,
        run: 30.0,
    });
    assert!(
        SlotSection::new(slot).is_err(),
        "an overshooting upper wall"
    );
}

#[test]
fn profile_digests_are_pinned() {
    let mut h = fnv1a_64(b"landscape.profiles.v1");
    let mut fold = |v: f64| h = mix64(h ^ v.to_bits());
    for (_, p) in monotone_profiles() {
        let (lo, hi) = p.domain();
        for i in 0..=64 {
            let u = lo + (hi - lo) * i as f64 / 64.0;
            let (v, s) = p.sample(u);
            fold(v);
            fold(s);
            fold(p.inverse(v));
        }
    }
    let d = DuneWave::new(0.72).unwrap();
    for i in 0..=64 {
        let (v, s) = d.sample(i as f64 / 64.0);
        fold(v);
        fold(s);
    }
    println!("profile digest 0x{h:016x}");
    assert_eq!(h, PROFILE_DIGEST, "profile arithmetic drifted");
}

const PROFILE_DIGEST: u64 = 0x00b7_0c33_f821_0ee0;

// ---------------------------------------------------------------------------
// Strata.

fn band_specs() -> Vec<BandSpec> {
    vec![
        // Canyon benches: band 27 ± 22%, wander 5, tread 0.3, cliff 0.13.
        BandSpec {
            band: 27.0,
            jitter: 0.22,
            wander: 5.0,
            tilt: 0.011,
            dir: (0.6, 0.8),
            tread: 0.3,
            cliff: 0.135,
            talus_rise: 0.4,
            vary: 2.0,
            roll: 0.3,
        },
        // Cliff strata: band 10 ± 3, a riser in the middle of each band.
        BandSpec {
            band: 10.0,
            jitter: 0.3,
            wander: 1.5,
            tilt: 0.0,
            dir: (1.0, 0.0),
            tread: 0.4,
            cliff: 0.2,
            talus_rise: 0.0,
            vary: 0.35,
            roll: 0.2,
        },
        // Thin, busy layers at the guard's limit.
        BandSpec {
            band: 6.0,
            jitter: 0.1,
            wander: 2.3,
            tilt: 0.05,
            dir: (-1.0, 2.0),
            tread: 0.9,
            cliff: 1.0,
            talus_rise: 0.9,
            vary: 5.0,
            roll: 0.9,
        },
    ]
}

#[test]
fn band_table_never_inverts_a_slope() {
    let mut stream = HashStream::new(0xba4d);
    for (i, spec) in band_specs().into_iter().enumerate() {
        for seed in 0..6u64 {
            let table = BandTable::new(spec, seed * 7919 + i as u64).unwrap();
            for _ in 0..8 {
                let (x, z) = (
                    stream.range_f((-5000.0, 5000.0)),
                    stream.range_f((-5000.0, 5000.0)),
                );
                let vary = [stream.range_f((-1.0, 1.0)), stream.range_f((-1.0, 1.0))];
                let column = table.column(x, z, vary);
                let mix = stream.unit();
                let mut prev = f64::NEG_INFINITY;
                let mut prev_mixed = f64::NEG_INFINITY;
                for step in 0..60_000 {
                    let raw = -200.0 + step as f64 * 0.01;
                    let fold = column.fold(raw);
                    assert!(fold.gain >= 0.0, "negative gain {} at {raw}", fold.gain);
                    assert!(
                        fold.height >= prev - 1e-9,
                        "fold fell at {raw}: {} < {prev}",
                        fold.height
                    );
                    let (mixed, gain) = column.apply(raw, mix);
                    assert!(gain >= 0.0 && mixed >= prev_mixed - 1e-9);
                    prev = fold.height;
                    prev_mixed = mixed;
                }
            }
        }
    }
}

#[test]
fn band_boundaries_never_cross_and_the_fold_is_continuous() {
    let mut stream = HashStream::new(0xb0);
    for spec in band_specs() {
        let table = BandTable::new(spec, 99).unwrap();
        let min_gap = spec.band * (1.0 - 2.0 * spec.jitter) - 2.0 * spec.wander;
        for _ in 0..200 {
            let vary = [stream.range_f((-1.0, 1.0)), stream.range_f((-1.0, 1.0))];
            let column = table.column(0.0, 0.0, vary);
            for k in -40..40 {
                let (a, b) = (table.boundary(k, vary), table.boundary(k + 1, vary));
                assert!(
                    b - a >= min_gap - 1e-9,
                    "boundaries {k} and {} too close",
                    k + 1
                );
                // Level and continuous across every boundary: zero gain on
                // it, vanishing gain either side.
                let (below, at, above) =
                    (column.fold(a - 1e-7), column.fold(a), column.fold(a + 1e-7));
                assert!((below.height - above.height).abs() < 1e-5);
                assert_eq!(at.gain, 0.0, "gain on boundary {k}");
                assert!(
                    below.gain < 1e-3 && above.gain < 1e-3,
                    "gains {} and {} by boundary {k}",
                    below.gain,
                    above.gain
                );
            }
        }
    }
}

#[test]
fn band_cursor_agrees_with_the_column() {
    let table = BandTable::new(band_specs()[0], 4).unwrap();
    let column = table.column(120.0, -40.0, [0.3, -0.6]);
    let mut cursor = column.cursor();
    let mut parts = Vec::new();
    for y in -100..400 {
        let yt = y as f64 + 0.5 + column.shift();
        let part = cursor.part(y);
        assert_eq!(part, column.band_at(yt).part(yt));
        if !parts.contains(&part) {
            parts.push(part);
        }
        let raw = y as f64 * 0.73;
        assert_eq!(cursor.fold(raw), column.fold(raw));
    }
    for part in [BandPart::Talus, BandPart::Cliff, BandPart::Tread] {
        assert!(
            parts.contains(&part),
            "a canyon wall shows talus, cliff and tread"
        );
    }
}

#[test]
fn band_table_refuses_crossing_boundaries() {
    let mut spec = band_specs()[0];
    spec.wander = 9.0;
    assert!(BandTable::new(spec, 1).is_err());
    spec.wander = 5.0;
    spec.jitter = 0.5;
    assert!(BandTable::new(spec, 1).is_err());
}

/// A Lipschitz bound on the folded height at a fixed raw height, per unit
/// of one slow field. With `H = lo + v(f)·span` and `f = (yt − lo)/span`:
/// boundaries move by at most `A` (so `lo` by `A`, `span` by `2A`); the
/// fold's gain is at most `G = 3/MIN_CLIFF_SHARE` (a monotone Hermite piece
/// is never steeper than three times its secant, and no secant exceeds
/// `1/MIN_CLIFF_SHARE`); tread and cliff shares move by at most
/// `tread·(1 + roll)·vary` and `cliff·(1 + roll)·vary/2`, which moves the
/// pieces' knots, and the talus's rise follows its share through a
/// smoothstep of slope at most `1.5/TALUS_FADE_SHARE`.
fn fold_lipschitz(spec: &BandSpec) -> f64 {
    use voxelize_gen::landscape::strata::{MIN_CLIFF_SHARE, TALUS_FADE_SHARE};
    let a = spec.wander;
    let g = 3.0 / MIN_CLIFF_SHARE;
    let span = spec.band * (1.0 + 2.0 * spec.jitter) + 2.0 * a;
    let tread = spec.tread * (1.0 + spec.roll) * spec.vary;
    let cliff = 0.5 * spec.cliff * (1.0 + spec.roll) * spec.vary;
    let rise = spec.talus_rise * 1.5 / TALUS_FADE_SHARE * (tread + cliff);
    3.0 * a + 3.0 * a * g + span * (g * (2.0 * tread + cliff) + rise)
}

/// Sweeps of `n1` at fixed raw heights, with steps of `h`: the largest
/// |Δ folded height|/h seen, and the steps that made the largest jumps
/// (column, raw height, n1 at the step's end).
#[allow(clippy::type_complexity)]
fn fold_sweeps(
    table: &BandTable,
    stream: &mut HashStream,
    lines: usize,
    h: f64,
) -> (f64, Vec<(f64, (f64, f64, f64), f64, f64)>) {
    let mut worst: f64 = 0.0;
    let mut jumps = Vec::new();
    for _ in 0..lines {
        let raw = stream.range_f((-300.0, 300.0));
        let n2 = stream.range_f((-1.0, 1.0));
        let (x, z) = (
            stream.range_f((-2000.0, 2000.0)),
            stream.range_f((-2000.0, 2000.0)),
        );
        let steps = (2.0 / h) as usize;
        let mut prev = table.column(x, z, [-1.0, n2]).fold(raw).height;
        let mut line_worst = (0.0, (x, z, n2), raw, 0.0);
        for k in 1..=steps {
            let n1 = -1.0 + k as f64 * h;
            let f = table.column(x, z, [n1, n2]).fold(raw).height;
            let jump = (f - prev).abs();
            worst = worst.max(jump / h);
            if jump > line_worst.0 {
                line_worst = (jump, (x, z, n2), raw, n1);
            }
            prev = f;
        }
        jumps.push(line_worst);
    }
    (worst, jumps)
}

#[test]
fn band_fold_is_continuous_from_column_to_column() {
    // Along the ground the slow fields and the dip's lift change a little
    // per block, so the folded height at one raw height must change a
    // little too: no talus, cliff or tread may appear or vanish with a step.
    let mut stream = HashStream::new(0xc0c0);
    for (i, spec) in band_specs().into_iter().enumerate() {
        let bound = fold_lipschitz(&spec);
        for seed in 0..3u64 {
            let table = BandTable::new(spec, seed * 31 + i as u64).unwrap();
            let h = 4e-4;
            let (rate, jumps) = fold_sweeps(&table, &mut HashStream::new(seed), 24, h);
            assert!(
                rate <= bound,
                "spec {i} seed {seed}: the fold changes at {rate} per unit field, above its Lipschitz bound {bound}"
            );
            // Refine every line's largest step a thousandfold: across a
            // step (a discontinuity) the largest sub-step keeps the whole
            // jump; across a steep but continuous stretch it shrinks with
            // the step.
            let mut worst_ratio = f64::INFINITY;
            for (jump, (x, z, n2), raw, n1) in jumps {
                if jump < 1e-9 {
                    continue;
                }
                let sub = h / 1000.0;
                let mut prev = table.column(x, z, [n1 - h, n2]).fold(raw).height;
                let mut sub_worst: f64 = 0.0;
                for k in 1..=1000 {
                    let f = table
                        .column(x, z, [n1 - h + k as f64 * sub, n2])
                        .fold(raw)
                        .height;
                    sub_worst = sub_worst.max((f - prev).abs());
                    prev = f;
                }
                worst_ratio = worst_ratio.min(jump / sub_worst.max(1e-300));
            }
            println!(
                "strata spec {i} seed {seed}: fold rate {rate:.1} per unit field (bound {bound:.0}); refining the largest steps 1000x shrinks them at least {worst_ratio:.0}x"
            );
            assert!(
                worst_ratio > 20.0,
                "spec {i} seed {seed}: a step keeps 1/{worst_ratio:.1} of its jump when refined 1000x: a discontinuity"
            );
        }
        // Along the dip, at fixed slow fields: the lift moves the fold by at
        // most (1 + gain)·tilt per block.
        let table = BandTable::new(spec, 5).unwrap();
        let slow = [stream.range_f((-1.0, 1.0)), stream.range_f((-1.0, 1.0))];
        let gain = 3.0 / voxelize_gen::landscape::strata::MIN_CLIFF_SHARE;
        for _ in 0..8 {
            let raw = stream.range_f((-200.0, 200.0));
            let mut prev = table.column(0.0, 0.0, slow).fold(raw).height;
            for k in 1..=20_000 {
                let x = k as f64 * 0.05;
                let f = table.column(x, 0.0, slow).fold(raw).height;
                assert!(
                    (f - prev).abs() <= (1.0 + gain) * spec.tilt.abs() * 0.05 + 1e-9,
                    "spec {i}: the fold steps along the dip at x {x}"
                );
                prev = f;
            }
        }
    }
}

#[test]
fn a_thinning_talus_slopes_away_instead_of_stepping() {
    // The case the old cutoff got wrong: a talus whose share shrinks to 0
    // along the wall. Its rise must shrink with it.
    let spec = band_specs()[0];
    let table = BandTable::new(spec, 3).unwrap();
    let mut stream = HashStream::new(0x7a1);
    let mut seen_thin = 0;
    for _ in 0..400 {
        let slow = [stream.range_f((-1.0, 1.0)), stream.range_f((-1.0, 1.0))];
        let column = table.column(0.0, 0.0, slow);
        for k in -6..6 {
            let lo = table.boundary(k, slow);
            let band = column.band_at(lo + 0.01);
            if band.talus_end > 0.0 && band.talus_end < 0.02 {
                seen_thin += 1;
            }
            // The talus's mean slope (rise over share) stays bounded.
            if band.talus_end > 0.0 {
                let top = band.fold(band.lo + band.talus_end * (band.hi - band.lo)).0;
                let rise = (top - band.lo) / (band.hi - band.lo);
                let secant = rise / band.talus_end;
                assert!(
                    secant
                        <= 1.125 * spec.talus_rise
                            / voxelize_gen::landscape::strata::TALUS_FADE_SHARE
                            + 1e-9,
                    "a talus {} of the band rises {rise}: a step, not a slope",
                    band.talus_end
                );
            }
        }
    }
    assert!(seen_thin > 0, "the sweep never met a thin talus");
}

// ---------------------------------------------------------------------------
// Geometry.

type Field<'a> = &'a dyn Fn(f64, f64) -> f64;

#[test]
fn lipschitz_gate_bounds_never_fall_below_dense_maxima() {
    let mut stream = HashStream::new(0x11f5);
    // psin's slope never exceeds 1 by more than its polynomial error.
    let mut max_d: f64 = 0.0;
    for i in 0..200_000 {
        let x = -4.0 + 8.0 * i as f64 / 200_000.0;
        max_d = max_d.max(((psin(x + 1e-6) - psin(x - 1e-6)) / 2e-6).abs());
    }
    assert!(max_d <= 1.0 + 1e-6);
    let mut tiles = 0;
    let mut dispatched = 0;
    for field in 0..40 {
        // A sum of waves with a known bound: Σ |a|·|k|.
        let waves: Vec<(f64, f64, f64, f64)> = (0..5)
            .map(|_| {
                (
                    stream.range_f((-1.0, 1.0)),
                    stream.range_f((-0.05, 0.05)),
                    stream.range_f((-0.05, 0.05)),
                    stream.range_f((0.0, 6.3)),
                )
            })
            .collect();
        let lip: f64 = waves
            .iter()
            .map(|&(a, kx, kz, _)| a.abs() * (kx * kx + kz * kz).sqrt())
            .sum::<f64>()
            * (1.0 + 1e-6);
        let wave = |x: f64, z: f64| {
            waves
                .iter()
                .map(|&(a, kx, kz, p)| a * psin(kx * x + kz * z + p))
                .sum::<f64>()
        };
        // A bilinear lattice of random values: bound √2·max|Δ|/g.
        let g = 24.0;
        let seed = stream.raw();
        let node = move |i: i64, j: i64| {
            voxelize_gen::hash_unit(mix64(
                seed ^ mix64((i as u64) << 32 ^ (j as u64 & 0xffff_ffff)),
            )) * 2.0
                - 1.0
        };
        let bilinear = |x: f64, z: f64| {
            let (i, j) = ((x / g).floor(), (z / g).floor());
            let (fx, fz) = (x / g - i, z / g - j);
            let (i, j) = (i as i64, j as i64);
            let a = node(i, j) + (node(i + 1, j) - node(i, j)) * fx;
            let b = node(i, j + 1) + (node(i + 1, j + 1) - node(i, j + 1)) * fx;
            a + (b - a) * fz
        };
        let bilinear_lip = 2.0 * std::f64::consts::SQRT_2 / g;
        for _ in 0..12 {
            let size = stream.range_f((32.0, 256.0));
            let stride = [4.0, 8.0, 16.0, 32.0][stream.range_i((0, 3)) as usize];
            let (x0, z0) = (
                stream.range_f((-3000.0, 3000.0)),
                stream.range_f((-3000.0, 3000.0)),
            );
            let fields: [(Field, f64); 2] = [(&wave, lip), (&bilinear, bilinear_lip)];
            for (f, l) in fields {
                let bound = tile_gate_bound(f, x0, z0, size, stride, l);
                let steps = (size / 0.5) as usize;
                let mut dense = f64::NEG_INFINITY;
                for i in 0..=steps {
                    for j in 0..=steps {
                        dense = dense.max(f(
                            x0 + size * i as f64 / steps as f64,
                            z0 + size * j as f64 / steps as f64,
                        ));
                    }
                }
                assert!(
                    dense <= bound,
                    "field {field}: dense max {dense} above bound {bound}"
                );
                tiles += 1;
                // A gate at the dense maximum minus a margin: the bound
                // dispatches every tile the dense scan does.
                if bound > 0.0 {
                    dispatched += 1;
                }
            }
        }
    }
    println!("gate bound: {dispatched}/{tiles} tiles admitted at threshold 0");
    assert_eq!(
        gate_upper_bound(&[0.25, -1.0], 2.0, 4.0),
        0.25 + 2.0 * 4.0 * std::f64::consts::FRAC_1_SQRT_2
    );
}

#[test]
fn footprint_edges_are_zero_on_the_bound_and_continuous() {
    let prints = vec![
        Footprint::disc((10.0, -4.0), 30.0),
        Footprint::rect((-20.0, -10.0), (25.0, 40.0)),
        Footprint::capsules(
            vec![(0.0, 0.0), (40.0, 10.0), (70.0, -15.0)],
            vec![6.0, 12.0, 4.0],
        ),
        Footprint::polygon(vec![(0.0, 0.0), (50.0, 5.0), (40.0, 45.0), (10.0, 30.0)]),
    ];
    let mut stream = HashStream::new(0xf007);
    for fp in prints {
        let faded = fp.clone().fade(8.0);
        let b = fp.bounds().grow(2.0);
        let mut on_bound = 0;
        for _ in 0..40_000 {
            let (x, z) = (
                stream.range_f((b.min_x, b.max_x)),
                stream.range_f((b.min_z, b.max_z)),
            );
            let (dx, dz) = (stream.range_f((-0.01, 0.01)), stream.range_f((-0.01, 0.01)));
            let (e0, e1) = (faded.edge(x, z), faded.edge(x + dx, z + dz));
            // smootherstep's slope is at most 1.875/width per block of SDF;
            // the SDFs are 1-Lipschitz, the tapered capsules a little more.
            assert!((e0 - e1).abs() <= 1.5 * 1.875 / 8.0 * (dx * dx + dz * dz).sqrt() + 1e-12);
            let d = fp.sdf_inside(x, z);
            if d <= 0.0 {
                assert_eq!(faded.edge(x, z), 0.0);
            }
            if d.abs() < 0.05 {
                on_bound += 1;
                assert!(faded.edge(x, z) < 1e-4);
            }
            if d >= 8.0 {
                assert_eq!(faded.edge(x, z), 1.0);
            }
        }
        assert!(on_bound > 0);
    }
    // Exact distances for the disc and the box.
    let disc = Footprint::disc((0.0, 0.0), 5.0);
    assert_eq!(disc.sdf_inside(3.0, 4.0), 0.0);
    assert_eq!(disc.sdf_inside(0.0, 0.0), 5.0);
    let rect = Footprint::rect((0.0, 0.0), (10.0, 4.0));
    assert_eq!(rect.sdf_inside(5.0, 1.0), 1.0);
    assert_eq!(rect.sdf_inside(13.0, 8.0), -5.0);
}

#[test]
fn zero_line_distance_is_exact_on_a_plane_and_forks_at_a_saddle() {
    let plane = |x: f64, z: f64| (0.6 * x - 0.8 * z + 3.0, 0.6, -0.8);
    let zl = zero_line_distance(plane, 10.0, -7.0, 1e-9);
    let truth = (0.6 * 10.0 + 0.8 * 7.0 + 3.0f64).abs();
    assert!((zl.first - truth).abs() < 1e-12 && (zl.refined - truth).abs() < 1e-12);
    // A saddle f = x·z: two courses crossing. Off the diagonal the first
    // estimate reads under the true distance; one Newton step recovers it.
    let saddle = |x: f64, z: f64| (x * z, z, x);
    let zl = zero_line_distance(saddle, 3.0, 3.0, 1e-9);
    assert!(zl.first < 2.5 && (zl.refined - 3.0).abs() < 0.5, "{zl:?}");
    let blended = zl.blend(1.0, 2.0);
    assert!(blended >= zl.first.min(zl.refined) && blended <= zl.first.max(zl.refined));
}

#[test]
fn iso_trace_follows_and_closes_a_contour() {
    let tracer = IsoTracer {
        step: 8.0,
        max_nodes: 200,
        gradient_h: 0.5,
        tolerance: 1e-6,
        min_turn: 0.5,
        max_correction: 0.8,
        flat: 1e-9,
    };
    let f = |x: f64, z: f64| (x * x + z * z).sqrt();
    let trace = tracer.trace(f, 100.0, (97.0, 3.0), 1.0, |_| true);
    assert_eq!(
        trace.end,
        IsoEnd::Closed,
        "{:?} after {} nodes",
        trace.end,
        trace.nodes.len()
    );
    for n in &trace.nodes {
        assert!(((n.x * n.x + n.z * n.z).sqrt() - 100.0).abs() <= 1e-6);
        assert!(
            (n.nx * n.x + n.nz * n.z) / 100.0 > 0.999,
            "normal points up the field"
        );
    }
    let again = tracer.trace(f, 100.0, (97.0, 3.0), 1.0, |_| true);
    assert_eq!(trace, again, "deterministic");
    let stopped = tracer.trace(f, 100.0, (97.0, 3.0), 1.0, |n| n.z < 50.0);
    assert_eq!(stopped.end, IsoEnd::Refused);
}

#[test]
fn arc_schedule_and_feature_frame() {
    let mut arc = ArcSchedule::new(2000.0);
    assert!(arc.reserve(100.0, 140.0));
    assert!(!arc.reserve(130.0, 160.0));
    let mut stream = HashStream::new(77);
    let placed = arc.place(0.0, 330.0, 0.4, 40.0, 1.0, &mut stream);
    assert!(!placed.is_empty());
    let r = arc.reserved();
    for w in r.windows(2) {
        assert!(w[0].1 < w[1].0, "reservations overlap: {w:?}");
    }
    let frame = FeatureFrame::new(vec![(0.0, 0.0), (100.0, 0.0), (100.0, 50.0)]);
    let p = frame.locate(50.0, 5.0);
    assert!((p.s - 50.0).abs() < 1e-12 && (p.d - 5.0).abs() < 1e-12);
    let q = frame.locate(50.0, -5.0);
    assert!((q.d + 5.0).abs() < 1e-12);
    let ((x, z), (tx, tz)) = frame.at(125.0);
    assert!(
        (x - 100.0).abs() < 1e-12
            && (z - 25.0).abs() < 1e-12
            && tx.abs() < 1e-12
            && (tz - 1.0).abs() < 1e-12
    );
    assert_eq!(frame.length(), 150.0);
}

#[test]
fn geometry_refuses_inputs_that_would_hang_or_lie() {
    let caught = |f: &dyn Fn()| std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err();
    // Arc schedules: a spacing below the ulp of the arc position, an
    // infinite arc, NaN.
    assert!(caught(&|| {
        ArcSchedule::new(f64::INFINITY);
    }));
    assert!(caught(&|| {
        ArcSchedule::new(1e6).place(0.0, 1e-300, 0.0, 1.0, 1.0, &mut HashStream::new(1));
    }));
    assert!(caught(&|| {
        ArcSchedule::new(1e6).place(f64::NAN, 10.0, 0.0, 1.0, 1.0, &mut HashStream::new(1));
    }));
    assert!(caught(&|| {
        ArcSchedule::new(1e6).place(0.0, 0.0, 0.0, 1.0, 1.0, &mut HashStream::new(1));
    }));
    // A start beyond the arc places nothing; a start next to its end walks
    // a bounded number of candidates.
    let mut arc = ArcSchedule::new(1e6);
    assert!(arc
        .place(2e6, 10.0, 0.0, 1.0, 1.0, &mut HashStream::new(1))
        .is_empty());
    let near_end = arc.place(1e6 - 1e-10, 1e-12, 0.0, 0.0, 1.0, &mut HashStream::new(1));
    assert!(
        (1..=2).contains(&near_end.len()),
        "steps below the position's precision collapse onto at most two points"
    );
    // Tile gates: no samples, bad strides, an undefined field.
    assert!(caught(&|| {
        gate_upper_bound(&[], 1.0, 4.0);
    }));
    assert!(caught(&|| {
        tile_gate_bound(|_, _| 0.0, 0.0, 0.0, 64.0, 0.0, 1.0);
    }));
    assert!(caught(&|| {
        tile_gate_bound(|_, _| 0.0, f64::NAN, 0.0, 64.0, 4.0, 1.0);
    }));
    assert!(caught(&|| {
        tile_gate_bound(|_, _| 0.0, 1e300, 0.0, 64.0, 4.0, 1.0);
    }));
    assert_eq!(gate_upper_bound(&[1.0, f64::NAN], 1.0, 4.0), f64::INFINITY);
    assert_eq!(
        tile_gate_bound(
            |x, _| if x > 20.0 { f64::NAN } else { 0.0 },
            0.0,
            0.0,
            64.0,
            4.0,
            1.0
        ),
        f64::INFINITY,
        "a field undefined somewhere in the tile admits it"
    );
}

// ---------------------------------------------------------------------------
// Lattices.

fn noise_node(seed: u64, f: f64) -> impl Fn(i32, i32, i32) -> f64 {
    let p = Perlin::new(seed);
    move |x, y, z| p.sample3(x as f64 * f, y as f64 * f * 1.6, z as f64 * f)
}

#[test]
fn lattice_seams_are_continuous() {
    let mut stream = HashStream::new(0x5ea);
    for spec in [
        LatticeSpec::cubic(3),
        LatticeSpec::cubic(4),
        LatticeSpec::new(6, 4),
        LatticeSpec::new(6, 6),
    ] {
        let node = noise_node(stream.raw(), 0.0085);
        for _ in 0..20 {
            let (cx, cz) = (stream.range_i((-50, 50)), stream.range_i((-50, 50)));
            let a_box = VoxelBox::new([cx * 16, -64, cz * 16], [cx * 16 + 15, 191, cz * 16 + 15]);
            let b_box = VoxelBox::new(
                [cx * 16 + 16, -64, cz * 16],
                [cx * 16 + 31, 191, cz * 16 + 15],
            );
            let c_box = VoxelBox::new(
                [cx * 16 + 5, -10, cz * 16 + 4],
                [cx * 16 + 27, 40, cz * 16 + 14],
            );
            let (a, b, c) = (
                Lattice::build(spec, a_box, 1, &node),
                Lattice::build(spec, b_box, 1, &node),
                Lattice::build(spec, c_box, 0, &node),
            );
            // The shared face, the margins, and an overlapping odd box.
            for y in -64..=191 {
                for z in cz * 16..=cz * 16 + 15 {
                    for x in [cx * 16 + 15, cx * 16 + 16] {
                        assert_eq!(
                            a.sample(x, y, z).to_bits(),
                            b.sample(x, y, z).to_bits(),
                            "seam at ({x}, {y}, {z})"
                        );
                    }
                }
            }
            for x in c_box.min[0]..=c_box.max[0] {
                for y in c_box.min[1]..=c_box.max[1] {
                    for z in c_box.min[2]..=c_box.max[2] {
                        let v = c.sample(x, y, z).to_bits();
                        let other = if x <= cx * 16 + 15 { &a } else { &b };
                        assert_eq!(v, other.sample(x, y, z).to_bits());
                    }
                }
            }
        }
    }
}

#[test]
fn lattice_samples_never_leave_their_corner_bounds() {
    let mut stream = HashStream::new(0xc0);
    let node = noise_node(9, 0.05);
    let lattice = Lattice::build(
        LatticeSpec::cubic(4),
        VoxelBox::new([0, 0, 0], [63, 63, 63]),
        0,
        &node,
    );
    for cell in lattice.cells(VoxelBox::new([0, 0, 0], [63, 63, 63])) {
        let corners = lattice.corners(cell.cell);
        let b = corners.bounds();
        for _ in 0..16 {
            let v = corners.lerp(stream.unit(), stream.unit(), stream.unit());
            assert!(v >= b.lo && v <= b.hi);
        }
        for x in cell.voxels.min[0]..=cell.voxels.max[0] {
            for y in cell.voxels.min[1]..=cell.voxels.max[1] {
                for z in cell.voxels.min[2]..=cell.voxels.max[2] {
                    let v = lattice.sample(x, y, z);
                    assert!(v >= b.lo && v <= b.hi);
                }
            }
        }
    }
}

#[test]
fn lattice_sample_f_matches_sample_at_voxels() {
    let mut stream = HashStream::new(0x5f);
    for spec in [
        LatticeSpec::cubic(3),
        LatticeSpec::new(6, 4),
        LatticeSpec::cubic(5),
    ] {
        let region = VoxelBox::new([-20, -13, 7], [20, 27, 47]);
        let lattice = Lattice::build(spec, region, 0, noise_node(stream.raw(), 0.03));
        for x in region.min[0]..=region.max[0] {
            for y in region.min[1]..=region.max[1] {
                for z in region.min[2]..=region.max[2] {
                    assert_eq!(
                        lattice.sample(x, y, z).to_bits(),
                        lattice.sample_f(x as f64, y as f64, z as f64).to_bits(),
                        "({x}, {y}, {z})"
                    );
                }
            }
        }
    }
}

#[test]
fn lattice_refuses_samples_outside_its_coverage() {
    let field = |x: i32, y: i32, z: i32| (x * 10_000 + y * 100 + z) as f64;
    let lattice = Lattice::build(
        LatticeSpec::cubic(4),
        VoxelBox::new([0, 0, 0], [15, 15, 15]),
        0,
        field,
    );
    let cover = lattice.coverage();
    assert_eq!(cover, VoxelBox::new([0, 0, 0], [15, 15, 15]));
    for p in [[0, 0, 0], [15, 15, 15], [7, 3, 11]] {
        assert_eq!(lattice.sample(p[0], p[1], p[2]), field(p[0], p[1], p[2]));
    }
    // Every voxel just past the coverage, on every face, panics instead of
    // reading the next row's nodes.
    for p in [
        [0, 0, 16],
        [0, 0, 19],
        [0, 16, 0],
        [0, 19, 1],
        [16, 0, 0],
        [-1, 0, 0],
        [0, -1, 0],
        [0, 0, -1],
    ] {
        let hit = std::panic::catch_unwind(|| lattice.sample(p[0], p[1], p[2]));
        assert!(hit.is_err(), "sample({p:?}) answered outside the coverage");
        let hit =
            std::panic::catch_unwind(|| lattice.sample_f(p[0] as f64, p[1] as f64, p[2] as f64));
        assert!(
            hit.is_err(),
            "sample_f({p:?}) answered outside the coverage"
        );
    }
    assert!(std::panic::catch_unwind(|| lattice.node([5, 0, 0])).is_err());
    assert!(std::panic::catch_unwind(|| lattice.corners([3, 3, 4])).is_err());
}

/// Carve or fill one region densely and with culling; return both sets and
/// the share of cells culled.
fn cull_compare(
    lattices: &[&Lattice],
    region: VoxelBox,
    may_hit: impl Fn(&[Interval], [i32; 3]) -> bool,
    hit: impl Fn(i32, i32, i32) -> bool,
) -> (BTreeSet<[i32; 3]>, BTreeSet<[i32; 3]>, f64) {
    let mut dense = BTreeSet::new();
    for x in region.min[0]..=region.max[0] {
        for y in region.min[1]..=region.max[1] {
            for z in region.min[2]..=region.max[2] {
                if hit(x, y, z) {
                    dense.insert([x, y, z]);
                }
            }
        }
    }
    let mut culled = BTreeSet::new();
    let (mut cells, mut skipped) = (0usize, 0usize);
    for cell in lattices[0].cells(region) {
        cells += 1;
        let bounds: Vec<Interval> = lattices
            .iter()
            .map(|l| l.corners(cell.cell).bounds())
            .collect();
        if !may_hit(&bounds, cell.cell) {
            skipped += 1;
            continue;
        }
        let v = cell.voxels;
        for x in v.min[0]..=v.max[0] {
            for y in v.min[1]..=v.max[1] {
                for z in v.min[2]..=v.max[2] {
                    if hit(x, y, z) {
                        culled.insert([x, y, z]);
                    }
                }
            }
        }
    }
    (dense, culled, skipped as f64 / cells as f64)
}

#[test]
fn culled_evaluation_equals_unculled_on_random_fields() {
    let mut stream = HashStream::new(0xc011);
    let region = VoxelBox::new([-24, -40, 8], [39, 87, 55]);
    let mut shares = Vec::new();
    for round in 0..6 {
        let spec = [
            LatticeSpec::new(6, 6),
            LatticeSpec::new(4, 4),
            LatticeSpec::new(6, 4),
        ][round % 3];
        let (sa, sb, sd) = (stream.raw(), stream.raw(), stream.raw());
        let a = Lattice::build(spec, region, 1, noise_node(sa, 0.0085));
        let b = Lattice::build(spec, region, 1, noise_node(sb, 0.0085));
        let detail = Lattice::build(spec, region, 1, noise_node(sd, 0.1));

        // Threshold: carve where A > t; skip a cell when no corner exceeds t.
        let t = stream.range_f((-0.2, 0.5));
        let (dense, culled, share) = cull_compare(
            &[&a],
            region,
            |bd, _| bd[0].hi > t,
            |x, y, z| a.sample(x, y, z) > t,
        );
        assert_eq!(dense, culled, "threshold cull changed the carve");
        shares.push(("threshold", share));

        // Thin pair: carve where |A| < w and |B| < w with w = w0·(1 + 0.4·D);
        // skip a cell when either field is beyond ±W, W the largest w.
        let w0 = stream.range_f((0.03, 0.09));
        let width =
            |x: i32, y: i32, z: i32| w0 * (1.0 + 0.4 * detail.sample(x, y, z).clamp(-1.0, 1.0));
        // The same expression at D = 1: rounding is monotone, so no width exceeds it.
        let wmax = w0 * (1.0 + 0.4 * 1.0);
        let (dense, culled, share) = cull_compare(
            &[&a, &b],
            region,
            |bd, _| bd[0].meets_open(-wmax, wmax) && bd[1].meets_open(-wmax, wmax),
            |x, y, z| {
                let w = width(x, y, z);
                a.sample(x, y, z).abs() < w && b.sample(x, y, z).abs() < w
            },
        );
        assert_eq!(dense, culled, "thin-pair cull changed the carve");
        shares.push(("thin_pair", share));

        // Separable: solid where (g − y)/s + amp_a·A + amp_d·D > 0, g a
        // per-column ground; a cell is all solid or all air when its bound
        // is, and only straddling cells are evaluated per voxel.
        let (s, amp_a, amp_d) = (
            stream.range_f((3.0, 9.0)),
            stream.range_f((-30.0, 30.0)),
            stream.range_f((-6.0, 6.0)),
        );
        let ground =
            |x: i32, z: i32| 20.0 + 15.0 * psin(x as f64 * 0.05) + 10.0 * pcos(z as f64 * 0.07);
        let density = |x: i32, y: i32, z: i32| {
            (ground(x, z) - y as f64) / s
                + amp_a * a.sample(x, y, z)
                + amp_d * detail.sample(x, y, z)
        };
        let cell_bound = |bd: &[Interval], cell: [i32; 3]| {
            let st = spec.stride;
            let (y0, y1) = (
                cell[1] * spec.stride_y,
                cell[1] * spec.stride_y + spec.stride_y - 1,
            );
            let (mut g_lo, mut g_hi) = (f64::INFINITY, f64::NEG_INFINITY);
            for x in cell[0] * st..cell[0] * st + st {
                for z in cell[2] * st..cell[2] * st + st {
                    g_lo = g_lo.min(ground(x, z));
                    g_hi = g_hi.max(ground(x, z));
                }
            }
            Interval::new((g_lo - y1 as f64) / s, (g_hi - y0 as f64) / s)
                + bd[0].scale(amp_a)
                + bd[1].scale(amp_d)
        };
        let mut dense = BTreeSet::new();
        for x in region.min[0]..=region.max[0] {
            for y in region.min[1]..=region.max[1] {
                for z in region.min[2]..=region.max[2] {
                    if density(x, y, z) > 0.0 {
                        dense.insert([x, y, z]);
                    }
                }
            }
        }
        let mut culled = BTreeSet::new();
        let (mut cells, mut decided) = (0, 0);
        for cell in a.cells(region) {
            cells += 1;
            let bound = cell_bound(
                &[
                    a.corners(cell.cell).bounds(),
                    detail.corners(cell.cell).bounds(),
                ],
                cell.cell,
            );
            let v = cell.voxels;
            if bound.hi <= 0.0 {
                decided += 1;
                continue;
            }
            for x in v.min[0]..=v.max[0] {
                for y in v.min[1]..=v.max[1] {
                    for z in v.min[2]..=v.max[2] {
                        if bound.lo > 0.0 || density(x, y, z) > 0.0 {
                            culled.insert([x, y, z]);
                        }
                    }
                }
            }
            if bound.lo > 0.0 {
                decided += 1;
            }
        }
        assert_eq!(dense, culled, "separable cull changed the solid");
        shares.push(("separable", decided as f64 / cells as f64));
    }
    for (form, share) in &shares {
        println!("cull share {form}: {:.1}%", share * 100.0);
    }
}

// ---------------------------------------------------------------------------
// Channels.

#[test]
fn channel_net_matches_brute_force() {
    let mut stream = HashStream::new(0xc4a);
    let lines: Vec<Vec<NetVertex<f64>>> = (0..6)
        .map(|_| {
            let (mut x, mut z) = (
                stream.range_f((-400.0, 400.0)),
                stream.range_f((-400.0, 400.0)),
            );
            (0..12)
                .map(|i| {
                    x += stream.range_f((-60.0, 60.0));
                    z += stream.range_f((-60.0, 60.0));
                    NetVertex::new(x, z, i as f64 * 10.0)
                })
                .collect()
        })
        .collect();
    let reach = 48.0;
    let net = ChannelNet::new(&lines, reach);
    let segments: Vec<((f64, f64), (f64, f64))> = lines
        .iter()
        .flat_map(|l| l.windows(2).map(|w| ((w[0].x, w[0].z), (w[1].x, w[1].z))))
        .collect();
    for _ in 0..20_000 {
        let (x, z) = (
            stream.range_f((-700.0, 700.0)),
            stream.range_f((-700.0, 700.0)),
        );
        let mut brute: Option<(f64, usize)> = None;
        for (i, &(a, b)) in segments.iter().enumerate() {
            let d = segment_distance((x, z), a, b).1;
            if d <= reach && brute.is_none_or(|(bd, _)| d < bd) {
                brute = Some((d, i));
            }
        }
        let hit = net.nearest(x, z);
        assert_eq!(hit.map(|h| (h.dist, h.segment as usize)), brute);
        let mut last = None;
        net.visit(x, z, |h| {
            assert!(last.is_none_or(|l| h.segment > l));
            last = Some(h.segment);
            assert!(h.payload() >= h.a.min(h.b) && h.payload() <= h.a.max(h.b));
        });
    }
    assert_eq!(Footprint::channel(&net, |_| 6.0).len(), 6);
}

// ---------------------------------------------------------------------------
// Floods.

fn bumpy(seed: u64) -> impl Fn(i32, i32) -> f64 + Clone {
    let p = Perlin::new(seed);
    move |x, z| {
        40.0 * p.sample2(x as f64 * 0.07, z as f64 * 0.07)
            + 12.0 * p.sample2(x as f64 * 0.21 + 50.0, z as f64 * 0.21)
    }
}

#[test]
fn lake_flood_fills_to_the_saddle() {
    // A bowl of radius ~20 with a notch to the east whose lip is 7.
    let bowl = |x: i32, z: i32| {
        let r = ((x * x + z * z) as f64).sqrt();
        let rim = if x > 0 && z.abs() <= 1 { 7.0 } else { 15.0 };
        (r / 20.0).min(1.0) * rim
            + if r > 20.0 {
                (r - 20.0) * if x > 0 && z.abs() <= 1 { -1.0 } else { 1.0 }
            } else {
                0.0
            }
    };
    let lake = lake_flood(
        bowl,
        (0, 0),
        &LakeLimits {
            max_probes: 100_000,
            max_radius: 60,
            max_depth: 50.0,
        },
    )
    .unwrap();
    assert!((lake.level - bowl(lake.spill.0, lake.spill.1)).abs() < 1e-12);
    assert!(
        lake.level > 6.0 && lake.level <= 7.0,
        "level {}",
        lake.level
    );
    assert!(lake.spill.0 > 0 && lake.spill.1.abs() <= 1);
    assert!(bowl(lake.outlet.0, lake.outlet.1) < lake.level);
    for &(x, z) in &lake.cells {
        assert!(bowl(x, z) < lake.level);
    }
    assert!(matches!(
        lake_flood(
            bowl,
            (0, 0),
            &LakeLimits {
                max_probes: 50,
                max_radius: 60,
                max_depth: 50.0
            }
        ),
        Err(LakeReject::Budget { .. })
    ));
    assert!(matches!(
        lake_flood(
            bowl,
            (0, 0),
            &LakeLimits {
                max_probes: 100_000,
                max_radius: 60,
                max_depth: 3.0
            }
        ),
        Err(LakeReject::TooDeep { .. })
    ));
}

#[test]
fn lake_floods_agree_with_the_priority_flood() {
    let (mut equal, mut nested) = (0, 0);
    for seed in 0..6 {
        let h = bumpy(seed);
        let (w, n) = (96usize, 96usize);
        let heights: Vec<f64> = (0..n)
            .flat_map(|j| (0..w).map(move |i| (i, j)))
            .map(|(i, j)| h(i as i32, j as i32))
            .collect();
        let drain = priority_flood(
            w,
            n,
            &heights,
            |i, j| i == 0 || j == 0 || i == w - 1 || j == n - 1,
            None,
        );
        for j in 1..n - 1 {
            for i in 1..w - 1 {
                let c = h(i as i32, j as i32);
                let is_min = [(-1, 0), (1, 0), (0, -1), (0, 1)]
                    .iter()
                    .all(|&(dx, dz)| h(i as i32 + dx, j as i32 + dz) > c);
                if !is_min {
                    continue;
                }
                // Past the grid's edge the ground falls away. A depression
                // spills at its lowest saddle: never above the filled
                // surface, and exactly at it when the spill leaves the grid
                // (a spill into a neighbouring basin fills further later).
                let limits = LakeLimits {
                    max_probes: 20_000,
                    max_radius: 200,
                    max_depth: 1e9,
                };
                let outside = |x: i32, z: i32| x < 0 || z < 0 || x >= w as i32 || z >= n as i32;
                let ground = |x: i32, z: i32| {
                    if outside(x, z) {
                        f64::NEG_INFINITY
                    } else {
                        h(x, z)
                    }
                };
                let lake = lake_flood(ground, (i as i32, j as i32), &limits).unwrap();
                let filled = drain.filled[drain.index(i, j)];
                assert!(
                    lake.level <= filled,
                    "seed {seed} at ({i}, {j}): spill above the filled surface"
                );
                if outside(lake.outlet.0, lake.outlet.1) {
                    assert_eq!(
                        lake.level.to_bits(),
                        filled.to_bits(),
                        "seed {seed} at ({i}, {j})"
                    );
                    equal += 1;
                } else {
                    nested += 1;
                }
            }
        }
    }
    println!("lake vs priority flood: {equal} spills off the grid equal, {nested} spills into a neighbour below");
    assert!(equal >= 3 && nested >= 3);
}

#[test]
fn floods_are_deterministic_and_their_caches_cost_only() {
    let h = bumpy(42);
    let limits = LakeLimits {
        max_probes: 50_000,
        max_radius: 120,
        max_depth: 100.0,
    };
    // A local minimum to seed.
    let mut seed = (0, 0);
    'search: for x in -40..40 {
        for z in -40..40 {
            let c = h(x, z);
            if [(-1, 0), (1, 0), (0, -1), (0, 1)]
                .iter()
                .all(|&(dx, dz)| h(x + dx, z + dz) > c)
            {
                seed = (x, z);
                break 'search;
            }
        }
    }
    let reference = lake_flood(h.clone(), seed, &limits);
    let cache: ClockCache<(i32, i32), f64> = ClockCache::new(1);
    let cached = lake_flood(
        |x, z| cache.get_or_insert_with((x, z), || h(x, z)),
        seed,
        &limits,
    );
    assert_eq!(reference, cached);
    let runs: Vec<_> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..4)
            .map(|_| s.spawn(|| lake_flood(h.clone(), seed, &limits)))
            .collect();
        handles.into_iter().map(|t| t.join().unwrap()).collect()
    });
    for r in runs {
        assert_eq!(r, reference);
    }
    // The filled surface is unique: rotating the grid half a turn rotates it.
    let (w, n) = (80usize, 64usize);
    let heights: Vec<f64> = (0..w * n)
        .map(|c| h((c % w) as i32, (c / w) as i32))
        .collect();
    let rotated: Vec<f64> = (0..w * n).map(|c| heights[w * n - 1 - c]).collect();
    let edge = |i: usize, j: usize| i == 0 || j == 0 || i == w - 1 || j == n - 1;
    let a = priority_flood(
        w,
        n,
        &heights,
        edge,
        Some(Divide {
            rise: 30.0,
            width: 3,
        }),
    );
    let b = priority_flood(
        w,
        n,
        &rotated,
        edge,
        Some(Divide {
            rise: 30.0,
            width: 3,
        }),
    );
    for c in 0..w * n {
        assert_eq!(a.filled[c].to_bits(), b.filled[w * n - 1 - c].to_bits());
    }
    assert_eq!(
        a,
        priority_flood(
            w,
            n,
            &heights,
            edge,
            Some(Divide {
                rise: 30.0,
                width: 3
            })
        )
    );
}

#[test]
fn priority_flood_drains_every_reached_cell_to_an_outlet() {
    let h = bumpy(7);
    let (w, n) = (128usize, 128usize);
    let heights: Vec<f64> = (0..w * n)
        .map(|c| h((c % w) as i32, (c / w) as i32))
        .collect();
    // Real outlets: cells below a sea level of −20; a divide keeps the rest
    // of the border shut.
    let outlet = |i: usize, j: usize| heights[j * w + i] < -20.0;
    let d = priority_flood(
        w,
        n,
        &heights,
        outlet,
        Some(Divide {
            rise: 96.0,
            width: 4,
        }),
    );
    let outlets = (0..w * n).filter(|&c| outlet(c % w, c / w)).count();
    assert!(outlets > 0);
    for c in 0..w * n {
        assert!(d.filled[c] >= d.ground[c]);
        if !d.reached[c] {
            continue;
        }
        let mut cur = c;
        let mut steps = 0;
        while d.receiver[cur] != NO_RECEIVER {
            let r = d.receiver[cur] as usize;
            let (ci, cj, ri, rj) = (cur % w, cur / w, r % w, r / w);
            assert_eq!(
                ci.abs_diff(ri) + cj.abs_diff(rj),
                1,
                "receivers are neighbours"
            );
            assert!(d.filled[r] <= d.filled[cur]);
            cur = r;
            steps += 1;
            assert!(steps <= w * n);
        }
        assert!(outlet(cur % w, cur / w), "cell {c} drains to a non-outlet");
    }
    let acc = d.accumulate(|c| if d.reached[c] { 1.0 } else { 0.0 });
    let at_outlets: f64 = (0..w * n)
        .filter(|&c| outlet(c % w, c / w))
        .map(|c| acc[c])
        .sum();
    let reached = d.reached.iter().filter(|&&r| r).count() as f64;
    assert_eq!(at_outlets, reached, "accumulation conserves runoff");
}

#[test]
fn floods_refuse_nan_and_treat_signed_zeros_alike() {
    let caught = |f: &dyn Fn()| std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err();
    let limits = LakeLimits {
        max_probes: 1000,
        max_radius: 20,
        max_depth: 50.0,
    };
    assert!(caught(&|| {
        let _ = lake_flood(
            |x, z| {
                if (x, z) == (1, 0) {
                    f64::NAN
                } else {
                    (x * x + z * z) as f64
                }
            },
            (0, 0),
            &limits,
        );
    }));
    let mut grid = vec![1.0; 25];
    grid[12] = f64::NAN;
    assert!(caught(&|| {
        priority_flood(5, 5, &grid, |i, _| i == 0, None);
    }));
    // A grid of zeros with mixed signs drains exactly like all +0.0.
    let mut stream = HashStream::new(0x2e);
    let mixed: Vec<f64> = (0..400)
        .map(|_| if stream.unit() < 0.5 { -0.0 } else { 0.0 })
        .collect();
    let plain = vec![0.0; 400];
    let (a, b) = (
        priority_flood(20, 20, &mixed, |i, j| i == 0 && j == 7, None),
        priority_flood(20, 20, &plain, |i, j| i == 0 && j == 7, None),
    );
    assert_eq!((a.receiver, a.order), (b.receiver, b.order));
}

// ---------------------------------------------------------------------------
// Settle: a synthetic falls under three fluid configurations.

const WATER: u32 = 100;
const STONE: u32 = 200;

fn fluid_registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_block(
        &Block::new("Water")
            .id(WATER)
            .is_fluid(true)
            .is_waterlogging_fluid(true)
            .build(),
    );
    registry.register_block(&Block::new("Stone").id(STONE).build());
    registry
}

/// A pool on a cliff top spilling over a lip into a bowl at the foot, in a
/// one-block channel: the curtain stamped at the rules' curtain level.
fn falls(rules: &FluidRules) -> (SettleBox, impl Fn([i32; 3]) -> bool) {
    let (pool_y, bowl_y, lip_x, z) = (18, 4, 7, 2);
    let stone = VoxelPacker::new().with_id(STONE).pack();
    let mut b = SettleBox::new(VoxelBox::new([0, 0, 0], [15, 23, 4]), stone);
    b.fill(b.bounds(), stone);
    b.fill(VoxelBox::new([2, pool_y + 1, z], [13, 23, z]), 0);
    b.fill(VoxelBox::new([lip_x, bowl_y + 1, z], [13, pool_y, z]), 0);
    for x in 2..lip_x {
        b.place_fluid(x, pool_y, z, WATER, 0);
    }
    for x in lip_x..=12 {
        b.place_fluid(x, bowl_y, z, WATER, 0);
    }
    b.place_fluid(lip_x, pool_y, z, WATER, FluidRules::SPREAD_FROM_SOURCE);
    for y in bowl_y + 1..pool_y {
        b.place_fluid(lip_x, y, z, WATER, rules.curtain_level());
    }
    let curtain =
        move |p: [i32; 3]| p[0] == lip_x && p[2] == z && (bowl_y + 1..=pool_y).contains(&p[1]);
    (b, curtain)
}

#[test]
fn settle_holds_a_synthetic_falls_under_three_fluid_configs() {
    let registry = fluid_registry();
    let configs = [
        ("default", FluidConfig::new()),
        (
            "flows_down_as_source",
            FluidConfig::new().flows_down_as_source(true),
        ),
        (
            "renews_reach_on_fall",
            FluidConfig::new().renews_reach_on_fall(true),
        ),
    ];
    let mut digests = BTreeSet::new();
    for (name, config) in configs {
        let rules = FluidRules::from(&config);
        digests.insert(rules.digest());
        let settler = Settler::new(&registry, WATER, config);
        let (stamp, curtain) = falls(&rules);
        let report = settler.check(&stamp, 64);
        if rules.open_curtain_holds() {
            assert!(
                report.changed_outside(&curtain).is_empty(),
                "{name}: water moved outside the curtain: {:?}",
                report.changed
            );
            assert!(
                report.is_still(),
                "{name}: the curtain itself moved: {:?}",
                report.changed
            );
            println!(
                "settle {name}: curtain level {}, still for 64 ticks",
                rules.curtain_level()
            );
        } else {
            // A curtain of sources spreads into the air in front of it, so
            // this configuration's falls are pre-settled instead.
            assert!(
                !report.changed_outside(&curtain).is_empty(),
                "{name}: a source curtain should spread"
            );
            let mut settled = stamp.clone();
            let ticks = settler
                .presettle(&mut settled, 2_000, 1_600)
                .expect("pre-settles");
            let after = settler.check(&settled, 64);
            assert!(
                after.is_still(),
                "{name}: pre-settled water still moves: {:?}",
                after.changed
            );
            println!(
                "settle {name}: curtain level {}, pre-settled in {ticks} ticks to {} wet voxels, then still for 64 ticks",
                rules.curtain_level(),
                settler.wet_count(&settled)
            );
        }
    }
    assert_eq!(digests.len(), 3, "each configuration has its own digest");
}

#[test]
fn fluid_rules_mirror_the_engine_config() {
    let d = FluidRules::from(&FluidConfig::new());
    assert_eq!(
        (d.falling_level(0), d.falling_level(3), d.reach()),
        (1, 3, 7)
    );
    assert!(d.refills(2) && !d.refills(1));
    let s = FluidRules::from(&FluidConfig::new().flows_down_as_source(true));
    assert_eq!(s.falling_level(5), 0);
    assert!(!s.open_curtain_holds());
    let r = FluidRules::from(&FluidConfig::new().renews_reach_on_fall(true));
    assert_eq!(r.falling_level(5), 1);
    let none = FluidRules::from(&FluidConfig::new().infinite_source(false, 2));
    assert!(!none.refills(4));
}

#[test]
fn fluid_level_answers_only_for_the_fluid_asked() {
    const LAVA: u32 = 101;
    let mut registry = fluid_registry();
    registry.register_block(&Block::new("Lava").id(LAVA).is_fluid(true).build());
    let stone = VoxelPacker::new().with_id(STONE).pack();
    let mut b = SettleBox::new(VoxelBox::new([0, 0, 0], [3, 3, 3]), stone);
    b.place_fluid(0, 0, 0, WATER, 2);
    b.place_fluid(1, 0, 0, LAVA, 3);
    let logged = BlockUtils::insert_waterlogged(VoxelPacker::new().with_id(STONE).pack(), true);
    b.set(2, 0, 0, BlockUtils::insert_waterlog_level(logged, 4));
    assert_eq!(b.fluid_level(&registry, 0, 0, 0, WATER), Some(2));
    assert_eq!(b.fluid_level(&registry, 0, 0, 0, LAVA), None);
    assert_eq!(b.fluid_level(&registry, 1, 0, 0, LAVA), Some(3));
    assert_eq!(b.fluid_level(&registry, 2, 0, 0, WATER), Some(4));
    assert_eq!(
        b.fluid_level(&registry, 2, 0, 0, LAVA),
        None,
        "a waterlogged block holds the waterlogging fluid, not lava"
    );
    assert_eq!(b.fluid_level(&registry, 3, 0, 0, WATER), None);
}

// ---------------------------------------------------------------------------
// Caches and lanes.

fn costly(k: u64) -> u64 {
    (0..64).fold(k, |h, i| mix64(h ^ i))
}

#[test]
fn clock_cache_is_cost_only() {
    let mut stream = HashStream::new(0xc10c);
    let keys: Vec<u64> = (0..50_000)
        .map(|i| {
            if stream.unit() < 0.7 {
                (i / 64) as u64 % 97
            } else {
                stream.raw() % 4096
            }
        })
        .collect();
    let direct: Vec<u64> = keys.iter().map(|&k| costly(k)).collect();
    for capacity in [1usize, 7, 1024, 100_000] {
        let cache: ClockCache<u64, u64> = ClockCache::new(capacity);
        let via: Vec<u64> = keys
            .iter()
            .map(|&k| cache.get_or_insert_with(k, || costly(k)))
            .collect();
        assert_eq!(via, direct, "capacity {capacity} changed a result");
        let stats = cache.stats();
        assert!(stats.len <= capacity);
        if capacity == 1 {
            assert!(stats.evictions > 0);
        }
        println!(
            "cache capacity {capacity}: {} hits, {} misses, {} evictions",
            stats.hits, stats.misses, stats.evictions
        );
    }
    let shared: ClockCache<u64, u64> = ClockCache::new(16);
    std::thread::scope(|s| {
        for t in 0..8u64 {
            let (shared, keys) = (&shared, &keys);
            s.spawn(move || {
                for &k in keys.iter().skip(t as usize).step_by(8) {
                    assert_eq!(shared.get_or_insert_with(k, || costly(k)), costly(k));
                }
            });
        }
    });
}

#[test]
fn clock_cache_solves_each_cold_key_once_under_contention() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, OnceLock};
    let keys = 200u64;
    let solves = AtomicUsize::new(0);
    let cache: ClockCache<u64, Arc<OnceLock<u64>>> = ClockCache::new(4096);
    let cells: ClockCache<u64, Arc<OnceLock<u64>>> = ClockCache::new(4096);
    std::thread::scope(|scope| {
        for t in 0..8u64 {
            let (cache, cells, solves) = (&cache, &cells, &solves);
            scope.spawn(move || {
                // Every thread walks every key, from its own starting point,
                // so cold keys are raced.
                for i in 0..keys {
                    let k = (i + t * 25) % keys;
                    let v = cache.get_or_solve(k, || {
                        solves.fetch_add(1, Ordering::Relaxed);
                        std::thread::yield_now();
                        costly(k)
                    });
                    assert_eq!(v, costly(k));
                    // Racing inserts of fresh cells all leave with the first.
                    let fresh = Arc::new(OnceLock::new());
                    let held = cells.insert(k, fresh.clone());
                    let again = cells.get_or_insert_with(k, || Arc::new(OnceLock::new()));
                    assert!(Arc::ptr_eq(&held, &again));
                }
            });
        }
    });
    assert_eq!(
        solves.load(Ordering::Relaxed),
        keys as usize,
        "a cold key was solved twice"
    );
    // First writer wins on a plain cache too.
    let plain: ClockCache<u64, u64> = ClockCache::new(4);
    assert_eq!(plain.insert(1, 10), 10);
    assert_eq!(plain.insert(1, 11), 10);
    assert_eq!(plain.get(&1), Some(10));
}

#[test]
fn seed_lanes_are_pinned_and_split_plan_from_build() {
    let expected = [
        (SeedLane::Landforms, 6u8),
        (SeedLane::Water, 7),
        (SeedLane::Sites, 8),
        (SeedLane::Volume, 9),
        (SeedLane::Spawn, 10),
    ];
    assert_eq!(SeedLane::ALL.len(), expected.len());
    let mut seeds = BTreeSet::new();
    for (lane, id) in expected {
        assert_eq!(lane.id(SeedPhase::Plan), id, "{lane:?} moved");
        assert_eq!(lane.id(SeedPhase::Build), id | 0x80, "{lane:?} build moved");
        assert!(lane.id(SeedPhase::Plan) >= FIRST_LAYER_LANE);
        for phase in [SeedPhase::Plan, SeedPhase::Build] {
            let seed = lane.seed(phase, 7, "surface", b"node", 42);
            assert_eq!(
                seed,
                stream_seed_lane(7, "surface", lane.id(phase), b"node", 42)
            );
            seeds.insert(seed);
        }
    }
    assert_eq!(
        seeds.len(),
        2 * SeedLane::ALL.len(),
        "every stream is its own"
    );
}

#[cfg(feature = "kit")]
#[test]
fn kit_assert_no_libm_passes_on_this_crate() {
    voxelize_gen::landscape::kit::assert_no_libm!("src/landscape");
}
