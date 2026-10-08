//! `voxelize.plain`: the heightfield core with no landforms.
//!
//! Base relief from named fields (docs/landscape.md, section 4.1):
//!
//! - **continents**: `c = 0.75 n_c(p + w) + 0.08`, a 4200-block fbm under a
//!   domain warp of ±380 blocks along x and ±270 along z from two
//!   independently salted noises (fold ratio 0.75, under the 0.8 limit);
//!   `land = smoothstep(-0.08, 0.08, c)`, `interior = smoothstep(0.08,
//!   0.48, c)`;
//! - **seabed**: a monotone spline of `c` plus a slow noise, from deep
//!   basins to a shelf, with a rough floor that fades out ashore;
//! - **routed relief**: `ruggedness` and `variety` (909- and 556-block
//!   fbm) and `ridge_fold = 1 - 3 |(|variety| - 2/3)|` with both folds
//!   rounded, so ridges wind along contours of `variety` without a crease;
//!   a nested monotone Hermite router `c -> ruggedness -> ridge_fold` gives
//!   the relief envelope as shares of the relief above sea;
//! - **plains**: a low datum rising inland, with a gentle 160-block swell;
//! - **hills**: a 220-block term scaled by the envelope (medium-scale
//!   energy, so the ground never reads fake-smooth);
//! - **ground**: `seabed + (land_h - seabed) * pow_smooth(land, 0.75)`;
//! - **wear** (block sizes, never scaled): on faces steeper than 0.86 a
//!   face texture of 8 blocks at 64 plus 2 at 16, and gullies with
//!   buttresses at 48 blocks on faces steeper than 1.3. Nothing on ground
//!   is finer than 16 blocks: no cavity-like fine erosion;
//! - **climate**: temperature and moisture at continental scale with a
//!   jittered border channel; the lapse cools high ground.
//!
//! Biomes are climate descriptors assigned after shape; paint is calm
//! (soil, a rock line, cliff rock, scree in patches, snow by temperature;
//! no per-voxel speckle); trees root only on soil, so woods stop at the
//! rock line and off rock faces; woods are places: a community field gives each patch of ground to a
//! broadleaf, pale or conifer wood or to an open meadow, stands roll their
//! species per stand, and dry lowlands carry scattered parasol groves.

use std::collections::BTreeMap;

use crate::landscape::fields::nodes::{fx::*, FieldExpr, TermRole};
use crate::landscape::library::{
    CliffParams, EcotonesParams, PaintCondM, PaintRuleM, PatchParams, RockLineParams, SnowParams,
    SurfaceRulesParams, TalusParams, ZonesParams,
};
use crate::landscape::mirror::{
    AxisM, AxisSourceM, BiomeM, BiomeSpecM, CanopyM, ClimateBoxM, ClimateM, ClimateRegionM,
    CommunityM, EcologyM, FloraSetM, FloraSpecM, GroveGateM, OverlayM, PartitionM, SpeciesM,
    TreeFormM,
};
use crate::landscape::spec::{
    CeilingSpec, ContentVersion, Domain, FieldDef, FrameSpec, Height, LandscapeSpec, PaintNode,
    PlanBudgets, Resolution, Size, TasteGuards, WaterSpec, LANDSCAPE_FORMAT,
};

use super::roles::standard_roles;
use super::Knobs;

/// The preset key.
pub const PLAIN: &str = "voxelize.plain";

fn def(graph: FieldExpr, domain: Domain, resolution: Resolution, keep: bool) -> FieldDef {
    FieldDef {
        graph,
        domain,
        resolution,
        range: None,
        keep,
    }
}

fn span(v: f64) -> Size {
    Size::Span(v)
}

fn blocks(v: f64) -> Size {
    Size::Blocks(v)
}

/// A rounded fold of `x` about 0 (smooth absolute value).
fn fold(x: FieldExpr, k: f64) -> FieldExpr {
    sabs(x, k)
}

/// The relief envelope `m(a, b)`: `b` in valleys and `a` on ridges (by
/// `ridge_fold`), scaled down where `ruggedness` is low. Shares of the
/// relief above sea.
fn envelope(a: f64, b: f64) -> FieldExpr {
    let by_fold = router(r("ridge_fold"), vec![(-1.0, relief(b)), (1.0, relief(a))]);
    router(
        r("ruggedness"),
        vec![
            (-1.0, by_fold.clone() * c(0.25)),
            (0.0, by_fold.clone() * c(0.6)),
            (1.0, by_fold * c(1.1)),
        ],
    )
}

fn rule(when: Vec<PaintCondM>, place: &str) -> PaintRuleM {
    PaintRuleM {
        when,
        place: place.to_string(),
    }
}

fn depth(min: u16, max: u16) -> PaintCondM {
    PaintCondM::Depth { min, max }
}

/// The plain preset for `knobs`.
pub fn plain_landscape(knobs: &Knobs) -> LandscapeSpec {
    let h = knobs.height as f64;
    let mut fields: BTreeMap<String, FieldDef> = BTreeMap::new();

    // Continents.
    let continent = warped(
        "plain.continent",
        span(4200.0),
        4,
        0.75,
        noise("plain.continent.warp_x", span(3200.0), 1, 1.0),
        noise("plain.continent.warp_z", span(3200.0), 1, 0.71),
        span(380.0),
    ) + c(0.08);
    fields.insert(
        "continentality".into(),
        def(continent, Domain::Macro, Resolution::Stride(16), true),
    );
    fields.insert(
        "land".into(),
        def(
            smoothstep(r("continentality"), -0.08, 0.08),
            Domain::Macro,
            Resolution::Full,
            false,
        ),
    );
    fields.insert(
        "interior".into(),
        def(
            smoothstep(r("continentality"), 0.08, 0.48),
            Domain::Macro,
            Resolution::Full,
            false,
        ),
    );

    // Seabed: basins to shelf, with a rough floor offshore.
    let shelf = r("continentality") + noise("plain.seabed", span(900.0), 3, 0.35);
    fields.insert(
        "seabed".into(),
        def(
            spline(
                shelf,
                &[
                    (-1.2, 0.066 * h),
                    (-0.6, 0.090 * h),
                    (-0.15, 0.121 * h),
                    (0.1, 0.148 * h),
                    (0.6, 0.164 * h),
                    (1.4, 0.191 * h),
                ],
            ),
            Domain::Macro,
            Resolution::Stride(16),
            false,
        ),
    );
    fields.insert(
        "seabed_rough".into(),
        def(
            noise("plain.seabed.rough", blocks(96.0), 2, 4.5) * sub(c(1.0), r("land")),
            Domain::Detail,
            Resolution::Full,
            false,
        ),
    );

    // The router.
    fields.insert(
        "ruggedness".into(),
        def(
            noise("plain.ruggedness", span(909.0), 3, 1.0),
            Domain::Macro,
            Resolution::Stride(16),
            false,
        ),
    );
    fields.insert(
        "variety".into(),
        def(
            noise("plain.variety", span(720.0), 2, 1.0),
            Domain::Macro,
            Resolution::Stride(16),
            false,
        ),
    );
    fields.insert(
        "ridge_fold".into(),
        def(
            sub(
                c(1.0),
                fold(fold(r("variety"), 0.25) - c(2.0 / 3.0), 0.15) * c(3.0),
            ),
            Domain::Macro,
            Resolution::Full,
            false,
        ),
    );
    // Regional high country: whole districts stand higher and rougher.
    fields.insert(
        "upland".into(),
        def(
            smoothstep(noise("plain.upland", span(2400.0), 2, 1.0), -0.15, 0.55),
            Domain::Macro,
            Resolution::Stride(16),
            false,
        ),
    );
    fields.insert(
        "relief".into(),
        def(
            router(
                r("continentality"),
                vec![
                    (-1.0, c(0.0)),
                    (-0.75, envelope(0.04, 0.012)),
                    (-0.05, envelope(0.30, 0.07)),
                    (0.65, envelope(0.55, 0.15)),
                    (1.0, envelope(0.62, 0.17)),
                ],
            ) * affine(r("upland"), 1.0, 0.35)
                + r("upland") * relief(0.08) * r("land"),
            Domain::Macro,
            Resolution::Full,
            false,
        ),
    );

    // Plains and hills.
    let datum = height(Height::AboveSea(2.0)) + r("interior") * c(5.0);
    let vd = smoothstep(r("ridge_fold"), -0.85, -0.35);
    fields.insert(
        "plains".into(),
        def(
            sum(vec![
                datum.clone(),
                sub(height(Height::AboveSea(7.0)), datum) * vd.clone(),
                noise("plain.plains", span(160.0), 3, 5.0) * affine(vd, 0.88, 0.12),
            ]),
            Domain::Detail,
            Resolution::Full,
            false,
        ),
    );
    fields.insert(
        "hills".into(),
        def(
            noise("plain.hills", span(260.0), 3, 1.0) * affine(r("relief"), 0.14, 3.0),
            Domain::Detail,
            Resolution::Full,
            false,
        ),
    );
    fields.insert(
        "land_h".into(),
        def(
            sum(vec![r("plains"), r("relief"), r("hills")]),
            Domain::Detail,
            Resolution::Full,
            false,
        ),
    );
    fields.insert(
        "base_ground".into(),
        def(
            sum(vec![
                r("seabed"),
                r("seabed_rough"),
                sub(r("land_h"), r("seabed") + r("seabed_rough")) * pow_smooth(r("land"), 0.75),
            ]),
            Domain::Detail,
            Resolution::Full,
            false,
        ),
    );

    // Wear: block sizes, slope-gated.
    let s = slope_of("base_ground");
    let face = smoothstep(s.clone(), 0.86, 2.1)
        * (noise("plain.wear.face", blocks(64.0), 2, 8.0)
            + noise("plain.wear.face_fine", blocks(16.0), 1, 2.0));
    let n48 = noise("plain.wear.gully", blocks(48.0), 1, 1.0);
    let channel = sub(
        c(1.0),
        smoothstep(FieldExpr::Abs(Box::new(n48.clone())), 0.0, 0.22),
    );
    let buttress = smoothstep(n48, 0.3, 0.75);
    let gully = smoothstep(s, 1.3, 2.1) * (buttress * c(6.0) - channel * c(10.0));
    fields.insert(
        "ground".into(),
        def(
            sum(vec![r("base_ground"), face, gully]),
            Domain::Detail,
            Resolution::Full,
            false,
        ),
    );

    // Climate.
    let jitter = |salt: &str| {
        FieldExpr::Noise(crate::landscape::fields::NoiseM {
            salt: salt.to_string(),
            wavelength: blocks(90.0),
            octaves: 3,
            persistence: 0.5,
            lacunarity: 2.0,
            amp: 0.03,
            role: TermRole::Shape,
            warp: None,
        })
    };
    fields.insert(
        "temperature".into(),
        def(
            sum(vec![
                c(0.50),
                noise("plain.temperature", span(2200.0), 3, 0.62),
                jitter("plain.temperature.jitter"),
            ]),
            Domain::Detail,
            Resolution::Full,
            false,
        ),
    );
    fields.insert(
        "moisture".into(),
        def(
            sum(vec![
                c(0.52),
                noise("plain.moisture", span(1800.0), 3, 0.45),
                r("interior") * c(-0.10),
                jitter("plain.moisture.jitter"),
            ]),
            Domain::Detail,
            Resolution::Full,
            false,
        ),
    );

    let biome = |doc: &str| BiomeM {
        doc: doc.to_string(),
        tint: None,
    };
    let biomes: BTreeMap<String, BiomeM> = [
        ("temperate.low", "temperate lowland"),
        ("temperate.high", "temperate upland"),
        ("cold.alpine", "cold high ground"),
        ("dry.low", "dry lowland"),
        ("dry.high", "dry upland"),
        ("wet.low", "wet lowland"),
        ("frozen", "frozen ground"),
        ("shore", "beaches and shallows"),
        ("seabed", "the sea floor"),
    ]
    .into_iter()
    .map(|(k, d)| (k.to_string(), biome(d)))
    .collect();
    let any = (-9.0, 9.0);
    let boxed = |b: &str, t: (f64, f64), m: (f64, f64), hh: (f64, f64)| ClimateBoxM {
        biome: b.to_string(),
        bounds: vec![t, m, hh],
    };
    let biome_spec = BiomeSpecM {
        climate: ClimateM {
            temperature: "temperature".into(),
            moisture: "moisture".into(),
            lapse: 0.55,
        },
        axes: vec![
            AxisM {
                key: "temperature".into(),
                source: AxisSourceM::Temperature,
            },
            AxisM {
                key: "moisture".into(),
                source: AxisSourceM::Moisture,
            },
            AxisM {
                key: "height".into(),
                source: AxisSourceM::HeightShare,
            },
        ],
        partition: PartitionM::Climate {
            axes: vec!["temperature".into(), "moisture".into(), "height".into()],
            regions: vec![ClimateRegionM {
                key: "all".into(),
                share: 1.0,
                boxes: vec![
                    boxed("frozen", (-9.0, 0.08), any, any),
                    boxed("cold.alpine", (0.08, 0.30), any, (0.20, 9.0)),
                    boxed("temperate.low", (0.08, 0.30), any, (-9.0, 0.20)),
                    boxed("temperate.high", (0.30, 0.62), (0.34, 9.0), (0.16, 9.0)),
                    boxed("temperate.low", (0.30, 0.66), (0.36, 0.70), (-9.0, 0.16)),
                    boxed("wet.low", (0.36, 0.80), (0.70, 9.0), (-9.0, 0.16)),
                    boxed("dry.low", (0.62, 9.0), (-9.0, 0.36), (-9.0, 0.16)),
                    boxed("dry.high", (0.55, 9.0), (-9.0, 0.34), (0.16, 9.0)),
                ],
            }],
            region_salt: "plain.biomes.region".into(),
            region_cell: span(2048.0),
            transition: 0.04,
        },
        overlays: vec![
            OverlayM::ShoreBand {
                biome: "shore".into(),
                below: 3,
                above: 2,
            },
            OverlayM::OpenWater {
                biome: "seabed".into(),
                min_depth: 4,
            },
        ],
        biomes,
    };

    // Paint.
    let mut tables: BTreeMap<String, Vec<PaintRuleM>> = BTreeMap::new();
    tables.insert(
        "temperate.low".into(),
        vec![
            rule(vec![depth(0, 0)], "soil.top"),
            rule(vec![depth(1, 3)], "soil.sub"),
        ],
    );
    tables.insert(
        "temperate.high".into(),
        vec![
            rule(vec![depth(0, 0)], "soil.top"),
            rule(vec![depth(1, 2)], "soil.sub"),
        ],
    );
    tables.insert(
        "wet.low".into(),
        vec![
            rule(vec![depth(0, 0)], "soil.top"),
            rule(vec![depth(1, 2)], "soil.wet"),
            rule(vec![depth(3, 4)], "soil.sub"),
        ],
    );
    // No per-voxel speckle anywhere: stone shows as patch-gated talus,
    // cliff rock and the rock line (ecotones), never as scattered voxels.
    tables.insert(
        "cold.alpine".into(),
        vec![
            rule(vec![depth(0, 0)], "soil.top"),
            rule(vec![depth(1, 2)], "soil.sub"),
        ],
    );
    tables.insert(
        "frozen".into(),
        vec![
            rule(vec![depth(0, 0)], "snow"),
            rule(vec![depth(1, 2)], "soil.sub"),
        ],
    );
    tables.insert(
        "dry.low".into(),
        vec![
            rule(vec![depth(0, 3)], "soil.dry"),
            rule(vec![depth(4, 9)], "rock.layer.0"),
        ],
    );
    tables.insert(
        "dry.high".into(),
        vec![
            rule(vec![depth(0, 1)], "soil.dry"),
            rule(vec![depth(2, 8)], "rock.layer.0"),
        ],
    );
    tables.insert(
        "shore".into(),
        vec![
            rule(vec![depth(0, 3)], "shore"),
            rule(vec![depth(4, 5)], "gravel"),
        ],
    );
    tables.insert(
        "seabed".into(),
        vec![
            rule(
                vec![depth(0, 2), PaintCondM::WaterDepth { min: 0, max: 18 }],
                "shore",
            ),
            rule(vec![depth(0, 1)], "bed.lake"),
        ],
    );
    let surface = SurfaceRulesParams {
        tables,
        default: vec![
            rule(vec![depth(0, 0)], "soil.top"),
            rule(vec![depth(1, 2)], "soil.sub"),
        ],
    };
    let ecotones = EcotonesParams {
        patch: PatchParams {
            salt: "plain.paint.patch".into(),
            wavelength: blocks(56.0),
        },
        hash_salt: "plain.paint.fray".into(),
        snow: Some(SnowParams {
            role: "snow".into(),
            temperature: 0.16,
            full: 0.06,
            patch_gain: 0.09,
            slope_gain: 0.045,
            depth: 1,
        }),
        rock_line: Some(RockLineParams {
            role: "rock.base".into(),
            above: Height::ShareOfRelief(0.30),
            jitter: 3.0,
            patch: 10.0,
            depth: 2,
        }),
        cliff: Some(CliffParams {
            role: "rock.base".into(),
            slope: (1.0, 2.0),
            patch_gain: 0.2,
            depth: 3,
        }),
        talus: Some(TalusParams {
            role: "talus".into(),
            slope: (0.6, 1.0),
            patch_above: 0.25,
            depth: 1,
        }),
    };
    let paint = vec![
        PaintNode {
            kind: "surface_rules".into(),
            params: serde_json::to_value(surface).expect("params serialize"),
        },
        PaintNode {
            kind: "ecotones".into(),
            params: serde_json::to_value(ecotones).expect("params serialize"),
        },
        PaintNode {
            kind: "zones".into(),
            params: serde_json::to_value(ZonesParams {
                zones: BTreeMap::new(),
            })
            .expect("params serialize"),
        },
    ];

    // Flora.
    let species = |log: &str, form: TreeFormM| SpeciesM {
        log: log.into(),
        leaves: "flora.broadleaf.leaf".into(),
        form,
    };
    let mut flora_species = BTreeMap::new();
    flora_species.insert(
        "broadleaf".to_string(),
        species("flora.broadleaf.log", TreeFormM::Round),
    );
    flora_species.insert(
        "broadleaf.wide".to_string(),
        species("flora.broadleaf.log", TreeFormM::Broad),
    );
    flora_species.insert(
        "pale".to_string(),
        species("flora.pale.log", TreeFormM::Slender),
    );
    flora_species.insert(
        "conifer".to_string(),
        species("flora.broadleaf.log", TreeFormM::Conic),
    );
    flora_species.insert(
        "parasol".to_string(),
        species("flora.broadleaf.log", TreeFormM::Umbrella),
    );
    let set = |salt: &str,
               biomes: &[&str],
               cell: f64,
               chance: f64,
               gate: Option<(f64, f64)>,
               points: (u8, u8),
               spread: f64,
               mix: &[(&str, f64)],
               cohesion: f64,
               max_slope: f64| FloraSetM {
        salt: salt.into(),
        biomes: biomes.iter().map(|b| b.to_string()).collect(),
        cell: span(cell),
        chance,
        gate: gate.map(|(w, lo)| GroveGateM {
            wavelength: span(w),
            window: (lo, 1.0),
        }),
        points,
        spread,
        species: mix.iter().map(|(k, w)| (k.to_string(), *w)).collect(),
        cohesion,
        age_spread: 0.3,
        max_slope,
        ground: None,
    };
    let mut sets = BTreeMap::new();
    sets.insert(
        "groves.dry".to_string(),
        set(
            "plain.flora.dry",
            &["dry.low"],
            72.0,
            0.2,
            None,
            (1, 2),
            4.0,
            &[("parasol", 1.0)],
            1.0,
            0.6,
        ),
    );
    // Woods as places: the community field gives each patch of ground to
    // one community (or to an open meadow), so stands of one kind cluster
    // and their borders fray into the neighbour's species.
    let canopy = |cell: f64,
                  chance: f64,
                  points: (u8, u8),
                  spread: f64,
                  mix: &[(&str, f64)],
                  cohesion: f64| CanopyM {
        cell: span(cell),
        chance,
        points,
        spread,
        species: mix.iter().map(|(k, w)| (k.to_string(), *w)).collect(),
        cohesion,
        age_spread: 0.3,
        max_slope: 0.9,
    };
    let community = |biomes: &[&str],
                     moisture: (f64, f64),
                     weight: f64,
                     canopy: Option<CanopyM>,
                     edge: &[(&str, f64)]| CommunityM {
        biomes: biomes.iter().map(|b| b.to_string()).collect(),
        ground: (Height::AboveSea(2.0), Height::ShareOfRelief(0.45)),
        max_slope: 0.9,
        moisture,
        weight,
        canopy,
        edge_species: edge.iter().map(|(k, w)| (k.to_string(), *w)).collect(),
    };
    let mut communities = BTreeMap::new();
    communities.insert(
        "wood.broadleaf".to_string(),
        community(
            &["temperate.low", "wet.low"],
            (0.35, 1.0),
            3.0,
            Some(canopy(
                18.0,
                0.8,
                (3, 7),
                7.0,
                &[("broadleaf", 3.0), ("broadleaf.wide", 1.0)],
                0.75,
            )),
            &[("pale", 1.0)],
        ),
    );
    communities.insert(
        "wood.pale".to_string(),
        community(
            &["temperate.low", "temperate.high"],
            (0.3, 0.8),
            2.0,
            Some(canopy(
                20.0,
                0.75,
                (3, 6),
                6.0,
                &[("pale", 3.0), ("broadleaf", 1.0)],
                0.8,
            )),
            &[("broadleaf", 1.0)],
        ),
    );
    communities.insert(
        "wood.conifer".to_string(),
        community(
            &["temperate.high", "cold.alpine"],
            (0.2, 1.0),
            2.0,
            Some(canopy(22.0, 0.7, (2, 6), 6.0, &[("conifer", 1.0)], 1.0)),
            &[("pale", 1.0)],
        ),
    );
    communities.insert(
        "meadow".to_string(),
        community(
            &["temperate.low", "temperate.high", "wet.low", "cold.alpine"],
            (0.0, 1.0),
            2.5,
            None,
            &[],
        ),
    );
    let ecology = EcologyM {
        salt: "plain.flora.communities".into(),
        cell: span(110.0),
        ecotone: 0.3,
        communities,
    };

    LandscapeSpec {
        format: LANDSCAPE_FORMAT,
        preset: PLAIN.to_string(),
        content_version: ContentVersion::new(0, 2, 0),
        frame: FrameSpec {
            height: knobs.height,
            sea: knobs.sea,
            ceiling: CeilingSpec {
                knee: Height::ShareOfWorld(0.88),
                cap: Height::Abs(h - 14.0),
            },
            bedrock: Height::Abs(2.0),
            scale: knobs.scale,
        },
        fill: "rock.base".into(),
        roles: standard_roles(),
        zones: BTreeMap::new(),
        water_kinds: BTreeMap::new(),
        claim_keys: BTreeMap::new(),
        fields,
        nodes: BTreeMap::new(),
        paint,
        biomes: biome_spec,
        flora: Some(FloraSpecM {
            species: flora_species,
            sets,
            ecology: Some(ecology),
        }),
        water: WaterSpec {
            sea: true,
            sea_fluid: "fluid.water".into(),
        },
        spawn: knobs.spawn.clone(),
        taste: TasteGuards::strict(),
        budgets: PlanBudgets::standard(),
    }
}
