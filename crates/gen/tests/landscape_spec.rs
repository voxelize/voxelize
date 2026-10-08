//! The landscape spec's number path, canonical writer, typed-param hashing,
//! merge patches, path-qualified errors and the JSON twin.

#[path = "fixtures/landscape.rs"]
mod land;

use serde_json::{json, Value};
use voxelize_gen::landscape::canon::{format_f64, hash_value, write_pretty, write_value};
use voxelize_gen::landscape::fields::nodes::{fx, FieldExpr};
use voxelize_gen::landscape::json;
use voxelize_gen::landscape::spec::{Domain, FieldDef, Resolution};
use voxelize_gen::landscape::{merge_patch, read_spec, CompileOptions, LandscapeSpec};

fn plain() -> LandscapeSpec {
    land::plain_spec(512)
}

fn identity_hash(spec: &LandscapeSpec) -> u64 {
    land::compile_spec(spec, 7, &CompileOptions::default())
        .identity()
        .spec_hash
}

#[test]
fn reader_refuses_what_a_spec_must_not_hold() {
    for (text, what) in [
        (r#"{"a": 1, "a": 2}"#, "duplicate key"),
        ("[NaN]", "NaN"),
        ("[Infinity]", "Infinity"),
        ("[1, 2,]", "trailing comma"),
        (r#"{"a": 1,}"#, "trailing comma"),
        ("[1e999]", "out of range"),
        ("[01]", "leading zero"),
    ] {
        let e = json::parse(text).unwrap_err();
        assert!(!e.at.is_empty(), "{what}: no position in {e}");
    }
    let deep = "[".repeat(65) + &"]".repeat(65);
    assert!(json::parse(&deep).unwrap_err().message.contains("nesting"));
}

#[test]
fn typed_errors_name_their_path() {
    let mut v = serde_json::to_value(plain()).unwrap();
    v["frame"]["sea"] = json!({"AboveSeaLevel": 3.0});
    let e = read_spec(&v.to_string()).unwrap_err();
    assert_eq!(e.path, "frame.sea", "{e}");
    let mut v = serde_json::to_value(plain()).unwrap();
    v["roles"]["snow"]["colour"] = json!("white");
    let e = read_spec(&v.to_string()).unwrap_err();
    assert!(e.path.starts_with("roles.snow"), "{e}");
    assert!(e.message.contains("unknown field"), "{e}");
    // A bad surfacer param is caught at compile with its spec path.
    let mut spec = plain();
    spec.paint[1].params["snow"]["full"] = json!(-1.0);
    let err = voxelize_gen::landscape::compile(
        &spec,
        &voxelize_gen::landscape::KindRegistry::with_builtins(),
        &voxelize_gen::landscape::RoleBinding::demo(),
        &land::demo_registry(),
        &land::config(7, 512),
    )
    .unwrap_err()
    .to_string();
    assert!(err.starts_with("paint.1.params.snow.full"), "{err}");
}

#[test]
fn twin_round_trips_to_the_same_bits_and_hash() {
    let spec = plain();
    let text = spec.to_pretty_json();
    let back = read_spec(&text).expect("the twin reads");
    assert_eq!(back, spec);
    assert_eq!(identity_hash(&back), identity_hash(&spec));
    // Compact and pretty forms are the same value.
    let compact = read_spec(&spec.to_canonical_json()).unwrap();
    assert_eq!(compact, spec);
}

#[test]
fn committed_twin_matches_the_builder() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/landscape/presets/plain.json");
    let text = std::fs::read_to_string(&path).expect("plain.json is committed");
    let twin = read_spec(&text).expect("plain.json reads strictly");
    let built = plain();
    assert_eq!(
        identity_hash(&twin),
        identity_hash(&built),
        "plain.json is stale: run `cargo run -p voxelize-gen --features unstable-landscape --example export_preset`"
    );
    assert_eq!(twin, built);
}

#[test]
fn floats_needing_17_digits_and_beyond_1e16_survive() {
    let tricky = [
        0.1 + 0.2,
        1.0 / 3.0,
        2.0f64.sqrt(),
        1.2345678901234567e16,
        9.007199254740993e15,
        1e16,
        1e300,
        5e-324,
        -0.0,
        123456789012345680.0,
    ];
    let mut spec = plain();
    let mut sum = Vec::new();
    for (i, v) in tricky.iter().enumerate() {
        sum.push(fx::c(*v) * fx::c(0.0));
        assert_eq!(
            format_f64(*v).parse::<f64>().unwrap().to_bits(),
            if *v == 0.0 {
                0.0f64.to_bits()
            } else {
                v.to_bits()
            },
            "case {i}"
        );
    }
    spec.fields.insert(
        "probe".into(),
        FieldDef {
            graph: FieldExpr::Sum(sum),
            domain: Domain::Detail,
            resolution: Resolution::Full,
            range: None,
            keep: false,
        },
    );
    let back = read_spec(&spec.to_canonical_json()).unwrap();
    let FieldExpr::Sum(terms) = &back.fields["probe"].graph else {
        panic!()
    };
    for (t, v) in terms.iter().zip(tricky) {
        let FieldExpr::Product(p) = t else { panic!() };
        let FieldExpr::Const(c) = p[0] else { panic!() };
        let want = if v == 0.0 { 0.0 } else { v };
        assert_eq!(c.to_bits(), want.to_bits(), "{v:e} read back as {c:e}");
    }
}

#[test]
fn canonical_bytes_ignore_map_order_and_pin_spellings() {
    let a: Value =
        serde_json::from_str(r#"{"b": 1.5, "a": [1, 2.0], "c": {"z": null, "y": "é"}}"#).unwrap();
    let mut m = serde_json::Map::new();
    m.insert("c".into(), json!({"y": "é", "z": null}));
    m.insert("a".into(), json!([1, 2.0]));
    m.insert("b".into(), json!(1.5));
    let b = Value::Object(m);
    assert_eq!(write_value(&a), write_value(&b));
    assert_eq!(
        write_value(&a),
        r#"{"a":[1,2.0],"b":1.5,"c":{"y":"é","z":null}}"#
    );
    assert_eq!(hash_value(&a), hash_value(&b));
    // Pretty and compact are the same value.
    let pretty = write_pretty(&a);
    assert_eq!(json::parse(&pretty).unwrap(), a);
    for (v, s) in [
        (1.0, "1.0"),
        (1e16, "1e16"),
        (1e-7, "1e-7"),
        (-0.0, "0.0"),
        (0.1, "0.1"),
    ] {
        assert_eq!(format_f64(v), s);
    }
}

#[test]
fn hashes_cover_typed_params() {
    let base = plain();
    let h = identity_hash(&base);
    // An optional field given as null or left out: both are None.
    let mut absent = base.clone();
    absent.paint[1].params["talus"] = Value::Null;
    let mut removed = base.clone();
    removed.paint[1]
        .params
        .as_object_mut()
        .unwrap()
        .remove("talus");
    assert_eq!(identity_hash(&absent), identity_hash(&removed));
    assert_ne!(identity_hash(&absent), h);
    // `1` and `1.0` for an f64 field.
    let mut int = base.clone();
    int.paint[1].params["cliff"]["patch_gain"] = json!(1);
    let mut float = base.clone();
    float.paint[1].params["cliff"]["patch_gain"] = json!(1.0);
    assert_eq!(identity_hash(&int), identity_hash(&float));
    // Key order inside params never matters.
    let reordered: Value = serde_json::from_str(&base.paint[1].params.to_string()).unwrap();
    let mut same = base.clone();
    same.paint[1].params = reordered;
    assert_eq!(identity_hash(&same), h);
}

#[test]
fn merge_patches_follow_rfc_7396() {
    let mut target = json!({"a": {"b": 1, "c": 2}, "d": [1, 2], "e": "x"});
    merge_patch(
        &mut target,
        &json!({"a": {"b": null, "f": 3}, "d": [3], "e": {"g": 1}}),
    );
    assert_eq!(
        target,
        json!({"a": {"c": 2, "f": 3}, "d": [3], "e": {"g": 1}})
    );
    let spec = plain();
    let patched = spec
        .patched(&json!({"frame": {"scale": 1.5}, "fields": {"ground": {"keep": true}}}))
        .expect("a valid patch");
    assert_eq!(patched.frame.scale, 1.5);
    assert!(patched.fields["ground"].keep);
    assert_ne!(identity_hash(&patched), identity_hash(&spec));
    // Removing a whole surfacer list entry is a list replacement.
    let fewer = spec
        .patched(&json!({"paint": [serde_json::to_value(&spec.paint[0]).unwrap()]}))
        .unwrap();
    assert_eq!(fewer.paint.len(), 1);
    // A patch that breaks the schema refuses with a path.
    let e = spec.patched(&json!({"frame": {"sea": 3}})).unwrap_err();
    assert_eq!(e.path, "frame.sea");
}

#[test]
fn identity_changes_with_what_decides_output() {
    let spec = plain();
    let a = land::compile_spec(&spec, 7, &CompileOptions::default());
    let b = land::compile_spec(&spec, 8, &CompileOptions::default());
    assert_eq!(a.identity().spec_hash, b.identity().spec_hash);
    assert_ne!(a.identity().world_seed, b.identity().world_seed);
    let kinds: Vec<&str> = a.identity().kinds.iter().map(|k| k.kind.as_str()).collect();
    assert_eq!(kinds, ["ecotones", "surface_rules", "zones"]);
    assert_eq!(a.identity().format, 2);
    assert_eq!(a.identity().algo, voxelize_gen::landscape::ENGINE_ALGO);
}

#[test]
fn enum_struct_variants_refuse_unknown_fields() {
    use voxelize_gen::landscape::library::PaintCondM;
    use voxelize_gen::landscape::spec::SpawnSpec;
    let e = json::from_str::<FieldExpr>(r#"{"SAbs":{"x":{"Const":1.0},"k":2.0,"bogus":3}}"#)
        .unwrap_err();
    assert!(e.message.contains("unknown field"), "{e:?}");
    let e = json::from_str::<PaintCondM>(r#"{"Depth":{"min":0,"max":3,"maxx":9}}"#).unwrap_err();
    assert!(e.message.contains("unknown field"), "{e:?}");
    let e = json::from_str::<SpawnSpec>(r#"{"Fixed":{"x":0,"z":0,"elevation":3}}"#).unwrap_err();
    assert!(e.message.contains("unknown field"), "{e:?}");
    // A typo in a merge patch refuses instead of patching nothing.
    let e = plain()
        .patched(&json!({"biomes": {"partition": {"Climate": {"transitionn": 0.5}}}}))
        .unwrap_err();
    assert!(
        e.path.starts_with("biomes.partition") && e.message.contains("unknown field"),
        "{e}"
    );
    let mut v = serde_json::to_value(plain()).unwrap();
    v["biomes"]["overlays"][0]["ShoreBand"]["wide"] = json!(2);
    let e = read_spec(&v.to_string()).unwrap_err();
    assert!(e.message.contains("unknown field"), "{e}");
}

#[test]
fn paint_errors_name_their_params_path() {
    use voxelize_gen::landscape::presets::RoleBinding;
    use voxelize_gen::landscape::KindRegistry;
    let refuse = |spec: &LandscapeSpec| {
        voxelize_gen::landscape::compile(
            spec,
            &KindRegistry::with_builtins(),
            &RoleBinding::demo(),
            &land::demo_registry(),
            &land::config(7, 512),
        )
        .unwrap_err()
    };
    let mut spec = plain();
    spec.paint[0].params["default"][0]["place"] = json!("soil.topp");
    let e = refuse(&spec);
    assert_eq!(e.path, "paint.0.params.default.0.place", "{e}");
    let mut spec = plain();
    spec.paint[2].params["zones"] = json!({"clif": {"role": "rock.base", "depth": 2}});
    let e = refuse(&spec);
    assert_eq!(e.path, "paint.2.params.zones.clif", "{e}");
    let mut spec = plain();
    spec.paint[1].params["rock_line"]["role"] = json!("rock.bas");
    let e = refuse(&spec);
    assert_eq!(e.path, "paint.1.params.rock_line.role", "{e}");
    let mut spec = plain();
    spec.paint[1].kind = "ecotone".into();
    let e = refuse(&spec);
    assert_eq!(e.path, "paint.1.kind", "{e}");
}

#[test]
fn frame_height_stays_inside_the_facts_storage() {
    use voxelize_gen::landscape::spec::MAX_FRAME_HEIGHT;
    use voxelize_gen::landscape::WorldFrame;
    let mut frame = plain().frame.clone();
    for height in [MAX_FRAME_HEIGHT + 16, 32768, 65536] {
        frame.height = height;
        let e = WorldFrame::from_spec(&frame).unwrap_err();
        assert_eq!(e.path, "frame.height", "{e}");
    }
}
