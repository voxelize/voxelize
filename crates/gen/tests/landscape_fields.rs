//! The field compiler: dead-node elimination and hash-consing (same bits
//! either way), the bandwidth, Lipschitz and range analyses (checked
//! against dense samples), the taste refusals in both modes, reference
//! errors, and grid equals point for strided and stencil fields.

use std::collections::BTreeMap;

use voxelize_gen::landscape::fields::nodes::{fx::*, FieldExpr, NoiseM, TermRole, WarpM};
use voxelize_gen::landscape::fields::{
    compile_fields, Area, CompiledFields, FieldsConfig, MacroTiles, SaltClaims,
};
use voxelize_gen::landscape::spec::{
    CeilingSpec, Domain, FieldDef, FrameSpec, Height, Resolution, Size, TasteGuards, WorldFrame,
};

fn frame() -> WorldFrame {
    WorldFrame::from_spec(&FrameSpec {
        height: 512,
        sea: Height::ShareOfWorld(0.168),
        ceiling: CeilingSpec {
            knee: Height::ShareOfWorld(0.88),
            cap: Height::Abs(498.0),
        },
        bedrock: Height::Abs(2.0),
        scale: 1.0,
    })
    .unwrap()
}

fn def(graph: FieldExpr, resolution: Resolution) -> FieldDef {
    FieldDef {
        graph,
        domain: Domain::Detail,
        resolution,
        range: None,
        keep: false,
    }
}

fn compile(
    defs: &BTreeMap<String, FieldDef>,
    outputs: &[&str],
    taste: &TasteGuards,
    cse: bool,
) -> Result<CompiledFields, String> {
    let f = frame();
    let outputs: Vec<String> = outputs.iter().map(|s| s.to_string()).collect();
    compile_fields(
        defs,
        &outputs,
        &FieldsConfig {
            frame: &f,
            world_seed: 7,
            dimension: "surface",
            taste,
            cse,
        },
        &mut SaltClaims::default(),
    )
    .map_err(|e| e.to_string())
}

fn sample(c: &CompiledFields, x: i32, z: i32) -> Vec<f64> {
    let tiles = MacroTiles::new(64);
    let g = c.evaluate(
        Area {
            x0: x,
            z0: z,
            w: 1,
            d: 1,
        },
        0,
        &tiles,
    );
    (0..c.outputs.len()).map(|o| g.output(o, x, z)).collect()
}

fn library() -> BTreeMap<String, FieldDef> {
    let mut d = BTreeMap::new();
    let n = |salt: &str, w: f64, oct: u8, amp: f64| noise(salt, Size::Span(w), oct, amp);
    d.insert(
        "base".into(),
        def(n("t.base", 600.0, 3, 1.0), Resolution::Stride(16)),
    );
    d.insert(
        "shape".into(),
        def(
            r("base") * relief(0.2) + n("t.hills", 200.0, 3, 6.0) + n("t.hills", 200.0, 3, 6.0),
            Resolution::Full,
        ),
    );
    d.insert(
        "fine".into(),
        def(n("t.fine", 64.0, 2, 3.0), Resolution::Stride(4)),
    );
    d.insert(
        "worn".into(),
        def(
            r("shape") + smoothstep(slope_of("shape"), 0.2, 1.0) * r("fine") + sabs(r("base"), 0.1),
            Resolution::Full,
        ),
    );
    d.insert(
        "unused".into(),
        def(n("t.unused", 300.0, 4, 50.0) * r("shape"), Resolution::Full),
    );
    d
}

#[test]
fn cse_and_dce_change_cost_never_bits() {
    let lib = library();
    let with = compile(&lib, &["worn"], &TasteGuards::strict(), true).unwrap();
    let without = compile(&lib, &["worn"], &TasteGuards::strict(), false).unwrap();
    assert!(
        with.op_count() < without.op_count(),
        "hash-consing should merge the twice-written hills ({} vs {})",
        with.op_count(),
        without.op_count()
    );
    assert!(!with.fields[with.field_index("unused").unwrap()].live);
    let all = compile(&lib, &["worn", "unused"], &TasteGuards::strict(), true).unwrap();
    assert!(all.op_count() > with.op_count());
    for i in 0..200 {
        let (x, z) = (i * 37 - 3000, i * 53 - 4000);
        let a = sample(&with, x, z);
        let b = sample(&without, x, z);
        let c = sample(&all, x, z);
        assert_eq!(a[0].to_bits(), b[0].to_bits(), "CSE changed ({x}, {z})");
        assert_eq!(a[0].to_bits(), c[0].to_bits(), "DCE changed ({x}, {z})");
    }
}

#[test]
fn grid_equals_point_through_strides_and_stencils() {
    let lib = library();
    let c = compile(
        &lib,
        &["worn", "base", "fine"],
        &TasteGuards::strict(),
        true,
    )
    .unwrap();
    let tiles = MacroTiles::new(64);
    let area = Area {
        x0: -37,
        z0: 251,
        w: 40,
        d: 33,
    };
    let g = c.evaluate(area, 0, &tiles);
    for dz in 0..area.d as i32 {
        for dx in 0..area.w as i32 {
            let (x, z) = (area.x0 + dx, area.z0 + dz);
            let p = sample(&c, x, z);
            for (o, v) in p.iter().enumerate() {
                assert_eq!(
                    v.to_bits(),
                    g.output(o, x, z).to_bits(),
                    "output {o} at ({x}, {z})"
                );
            }
        }
    }
}

#[test]
fn analyses_bound_what_dense_samples_see() {
    let lib = library();
    let names = ["base", "shape", "fine", "worn"];
    let c = compile(&lib, &names, &TasteGuards::strict(), true).unwrap();
    let tiles = MacroTiles::new(256);
    let area = Area {
        x0: -700,
        z0: 300,
        w: 400,
        d: 400,
    };
    let g = c.evaluate(area, 0, &tiles);
    for (o, name) in names.iter().enumerate() {
        let a = c.analysis(name).unwrap();
        let mut max_step: f64 = 0.0;
        for dz in 0..area.d as i32 {
            for dx in 0..area.w as i32 {
                let (x, z) = (area.x0 + dx, area.z0 + dz);
                let v = g.output(o, x, z);
                assert!(
                    v >= a.range.0 && v <= a.range.1,
                    "{name}: {v} outside {:?}",
                    a.range
                );
                if dx > 0 {
                    max_step = max_step.max((v - g.output(o, x - 1, z)).abs());
                }
            }
        }
        if let Some(l) = a.lipschitz {
            assert!(
                max_step <= l * 1.0000001,
                "{name}: step {max_step} beats Lipschitz {l}"
            );
        }
    }
    // Bandwidth: a 600-block, 3-octave fbm carries 150 blocks.
    assert_eq!(c.analysis("base").unwrap().wavelength, Some(150.0));
    // A crease makes it unknown; a smooth fold keeps it.
    let mut d = BTreeMap::new();
    d.insert(
        "n".into(),
        def(noise("t.n", Size::Span(512.0), 2, 1.0), Resolution::Full),
    );
    d.insert(
        "hard".into(),
        def(FieldExpr::Abs(Box::new(r("n"))), Resolution::Full),
    );
    d.insert("soft".into(), def(sabs(r("n"), 0.1), Resolution::Full));
    let c = compile(&d, &["hard", "soft"], &TasteGuards::strict(), true).unwrap();
    assert_eq!(c.analysis("hard").unwrap().wavelength, None);
    assert_eq!(c.analysis("soft").unwrap().wavelength, Some(256.0));
    // A warp shortens the bandwidth by 1 / (1 + amp 2 pi / wavelength).
    let mut d = BTreeMap::new();
    d.insert(
        "ground".into(),
        def(
            warped(
                "t.w",
                Size::Span(1000.0),
                1,
                1.0,
                noise("t.wx", Size::Span(2000.0), 1, 1.0),
                noise("t.wz", Size::Span(2000.0), 1, 1.0),
                Size::Span(100.0),
            ),
            Resolution::Full,
        ),
    );
    let c = compile(&d, &["ground"], &TasteGuards::strict(), true).unwrap();
    let w = c.analysis("ground").unwrap().wavelength.unwrap();
    let want = 1000.0 / (1.0 + 100.0 * std::f64::consts::TAU / 2000.0);
    assert!((w - want).abs() < 1e-9, "{w} vs {want}");
}

fn ground_only(graph: FieldExpr) -> BTreeMap<String, FieldDef> {
    let mut d = BTreeMap::new();
    d.insert("ground".into(), def(graph, Resolution::Full));
    d
}

#[test]
fn taste_refuses_cut_and_cavity_terms_and_warns_in_warn_mode() {
    let fine_shape = ground_only(noise("t.fine", Size::Blocks(8.0), 1, 2.0));
    let e = compile(&fine_shape, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.contains("wavelength on ground"), "{e}");
    let warned = compile(&fine_shape, &["ground"], &TasteGuards::warn(), true).unwrap();
    assert!(warned
        .lints
        .iter()
        .any(|l| l.contains("wavelength on ground")));

    let loud_grain = ground_only(FieldExpr::Noise(NoiseM {
        salt: "t.grain".into(),
        wavelength: Size::Blocks(6.0),
        octaves: 1,
        persistence: 0.5,
        lacunarity: 2.0,
        amp: 1.0,
        role: TermRole::Grain,
        warp: None,
    }));
    let e = compile(&loud_grain, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.contains("cavity"), "{e}");
    let quiet_grain = ground_only(FieldExpr::Noise(NoiseM {
        salt: "t.grain".into(),
        wavelength: Size::Blocks(6.0),
        octaves: 1,
        persistence: 0.5,
        lacunarity: 2.0,
        amp: 0.3,
        role: TermRole::Grain,
        warp: None,
    }));
    compile(&quiet_grain, &["ground"], &TasteGuards::strict(), true).unwrap();

    let folded = ground_only(FieldExpr::Noise(NoiseM {
        salt: "t.f".into(),
        wavelength: Size::Span(1000.0),
        octaves: 2,
        persistence: 0.5,
        lacunarity: 2.0,
        amp: 1.0,
        role: TermRole::Shape,
        warp: Some(WarpM {
            x: Box::new(noise("t.fx", Size::Span(400.0), 1, 1.0)),
            z: Box::new(noise("t.fz", Size::Span(400.0), 1, 1.0)),
            amp: Size::Span(80.0),
        }),
    }));
    let e = compile(&folded, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.contains("folds at 1.257"), "{e}");

    let strata = ground_only(FieldExpr::Pulse {
        x: Box::new(c(100.0)),
        period: 4.0,
        softness: 0.3,
        role: TermRole::Strata,
    });
    let e = compile(&strata, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.contains("Strata pulse"), "{e}");

    // Terms off the spine are not ground: climate may be fine-grained.
    let mut d = ground_only(c(90.0));
    d.insert(
        "speckle".into(),
        def(noise("t.s", Size::Blocks(4.0), 1, 1.0), Resolution::Full),
    );
    compile(&d, &["ground", "speckle"], &TasteGuards::strict(), true).unwrap();
}

#[test]
fn references_refuse_with_their_path() {
    let mut d = ground_only(r("missing"));
    let e = compile(&d, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(
        e.starts_with("fields.ground.graph") && e.contains("missing"),
        "{e}"
    );
    d = ground_only(r("a"));
    d.insert("a".into(), def(r("b") + c(1.0), Resolution::Full));
    d.insert("b".into(), def(r("a"), Resolution::Full));
    let e = compile(&d, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(
        e.contains("field cycle") && e.contains("a -> b -> a"),
        "{e}"
    );
    // A strided field may not read a stencil.
    let mut d = ground_only(r("s"));
    d.insert("s".into(), def(slope_of("ground2"), Resolution::Stride(4)));
    d.insert("ground2".into(), def(c(1.0), Resolution::Full));
    let e = compile(&d, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.contains("strided field may not read"), "{e}");
    // A Macro field carrying fine wavelengths.
    let mut d = ground_only(r("m"));
    d.insert(
        "m".into(),
        FieldDef {
            graph: noise("t.m", Size::Span(256.0), 4, 1.0),
            domain: Domain::Macro,
            resolution: Resolution::Full,
            range: None,
            keep: false,
        },
    );
    let e = compile(&d, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.contains("Macro needs at least 128"), "{e}");
    // A declared range the analysis cannot prove.
    let mut d = ground_only(noise("t.r", Size::Span(256.0), 1, 10.0));
    d.get_mut("ground").unwrap().range = Some((-5.0, 5.0));
    let e = compile(&d, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.starts_with("fields.ground.range"), "{e}");
    // Salts: one salt never seeds two differently shaped terms, and the
    // engine namespace is reserved.
    let d = ground_only(
        noise("t.x", Size::Span(256.0), 2, 1.0) + noise("t.x", Size::Span(300.0), 2, 1.0),
    );
    let e = compile(&d, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.contains("already claimed"), "{e}");
    let d = ground_only(noise("engine.x", Size::Span(256.0), 2, 1.0));
    let e = compile(&d, &["ground"], &TasteGuards::strict(), true).unwrap_err();
    assert!(e.contains("reserved"), "{e}");
}

#[test]
fn router_is_monotone_and_inside_its_knots() {
    let mut d = BTreeMap::new();
    d.insert(
        "x".into(),
        def(noise("t.x", Size::Span(300.0), 2, 1.2), Resolution::Full),
    );
    d.insert(
        "k".into(),
        def(noise("t.k", Size::Span(500.0), 1, 1.0), Resolution::Full),
    );
    d.insert(
        "ground".into(),
        def(
            router(
                r("x"),
                vec![
                    (-1.0, c(0.0)),
                    (-0.2, r("k") * c(4.0) + c(10.0)),
                    (0.5, c(30.0)),
                    (1.0, c(31.0)),
                ],
            ),
            Resolution::Full,
        ),
    );
    let c = compile(&d, &["ground", "x", "k"], &TasteGuards::strict(), true).unwrap();
    let a = c.analysis("ground").unwrap();
    for i in 0..2000 {
        let v = sample(&c, i * 13 - 9000, i * 7 + 400);
        assert!(v[0] >= a.range.0 - 1e-12 && v[0] <= a.range.1 + 1e-12);
        // Between the knots at -1 and -0.2 the value lies between theirs.
        if v[1] > -1.0 && v[1] < -0.2 {
            let hi = v[2] * 4.0 + 10.0;
            assert!(v[0] >= 0.0f64.min(hi) - 1e-9 && v[0] <= 0.0f64.max(hi) + 1e-9);
        }
    }
}
