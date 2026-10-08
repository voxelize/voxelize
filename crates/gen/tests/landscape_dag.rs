//! The planner DAG and the composition order: refusals (each
//! path-qualified), the default "after built-ins" order with its
//! `ImplicitOrder` lint, and composition order independent of the DAG.

#[path = "fixtures/kinds.rs"]
mod kinds;
#[path = "fixtures/landscape.rs"]
mod land;
#[path = "../examples/sinkhole.rs"]
mod sinkhole;

use kinds::*;
use voxelize_gen::landscape::fields::nodes::FieldExpr;
use voxelize_gen::landscape::kit::{self, mesa_node};
use voxelize_gen::landscape::prelude::*;
use voxelize_gen::landscape::spec::{ClaimKeyDecl, NodeSpec};
use voxelize_gen::landscape::CompileOptions;

fn base() -> LandscapeSpec {
    kit::proving_landscape(&voxelize_gen::landscape::Knobs::test())
}

fn assert_refused(spec: &LandscapeSpec, path: &str, says: &str) {
    let e = refusal(spec);
    assert_eq!(e.path, path, "refusal at the wrong path: {e}");
    assert!(
        e.message.contains(says),
        "refusal {e} does not say {says:?}"
    );
}

#[test]
fn the_proving_preset_compiles_with_its_dag() {
    let land = compile(&proving_spec(256), 7, &CompileOptions::default());
    let dag = land.dag();
    assert_eq!(dag.order, vec!["mesas", "sinkholes", "swells"]);
    let has = |from: &str, to: &str, handle: &str| {
        dag.edges
            .iter()
            .any(|e| e.from == from && e.to == to && e.handle == handle)
    };
    assert!(has("field:karst", "sinkholes", "field"));
    assert!(has("mesas", "sinkholes", "occupancy"));
    assert!(has("mesas", "sinkholes", "probe Layer(Incise)"));
    assert!(has("field:proving.swells.gate", "swells", "local_field"));
    assert!(has("mesas", "engine.spawn", "spawn search"));
    assert!(dag.spawn_readers.is_empty());
    let text = dag.to_text();
    assert!(text.contains("composition order:"));
    assert!(dag.to_dot().starts_with("digraph"));
}

#[test]
fn a_cycle_is_refused_and_printed() {
    let spec = base()
        .with_node(
            "a",
            probe(
                "t.a",
                ProbeParams {
                    plans_of: Some("b".into()),
                    ..Default::default()
                },
            ),
        )
        .with_node(
            "b",
            probe(
                "t.b",
                ProbeParams {
                    plans_of: Some("a".into()),
                    ..Default::default()
                },
            ),
        );
    let e = refusal(&spec);
    assert_eq!(e.path, "nodes.a");
    assert!(e.message.contains("planner cycle: a → b → a"), "{e}");
    assert!(e.message.contains("break it"), "{e}");
    // A node reading its own plans is a cycle of one.
    let spec = base().with_node(
        "a",
        probe(
            "t.a",
            ProbeParams {
                plans_of: Some("a".into()),
                ..Default::default()
            },
        ),
    );
    assert!(refusal(&spec).message.contains("a → a"));
}

#[test]
fn a_probe_through_its_own_or_a_later_layer_is_refused() {
    let spec = base().with_node(
        "p",
        probe(
            "t.p",
            ProbeParams {
                layer: Some(Layer::Uplift),
                through: Some(ThroughP::Layer(Layer::Detail)),
                ..Default::default()
            },
        ),
    );
    assert_refused(&spec, "nodes.p", "includes its own layer Uplift");
    // Through its own layer (strictly below it) is fine.
    let ok = base().with_node(
        "p",
        probe(
            "t.p",
            ProbeParams {
                layer: Some(Layer::Incise),
                through: Some(ThroughP::Layer(Layer::Incise)),
                ..Default::default()
            },
        ),
    );
    compile(&ok, 7, &CompileOptions::default());
}

#[test]
fn a_same_layer_read_must_compose_strictly_earlier() {
    // Facts of a same-layer node without an explicit over path.
    let spec = base().with_node(
        "p",
        probe(
            "t.p",
            ProbeParams {
                layer: Some(Layer::Uplift),
                facts_of: Some("mesas".into()),
                ..Default::default()
            },
        ),
    );
    assert_refused(&spec, "nodes.p", "does not compose strictly earlier");
    // With "over": the read is legal.
    let mut over = probe(
        "t.p",
        ProbeParams {
            layer: Some(Layer::Uplift),
            facts_of: Some("mesas".into()),
            ..Default::default()
        },
    );
    over.over = vec!["mesas".into()];
    compile(&base().with_node("p", over), 7, &CompileOptions::default());
    // From a later layer it is legal too.
    let later = probe(
        "t.p",
        ProbeParams {
            layer: Some(Layer::Incise),
            facts_of: Some("mesas".into()),
            ..Default::default()
        },
    );
    compile(&base().with_node("p", later), 7, &CompileOptions::default());
    // A same-layer Through::With probe follows the same rule.
    let with = probe(
        "t.p",
        ProbeParams {
            layer: Some(Layer::Uplift),
            through: Some(ThroughP::With(vec!["mesas".into()])),
            ..Default::default()
        },
    );
    assert_refused(
        &base().with_node("p", with),
        "nodes.p",
        "does not compose strictly earlier",
    );
}

#[test]
fn a_wrong_kind_handle_is_refused() {
    // Plans of a mesa read as a probe.
    let spec = base().with_node(
        "p",
        probe(
            "t.p",
            ProbeParams {
                plans_of: Some("mesas".into()),
                ..Default::default()
            },
        ),
    );
    assert_refused(
        &spec,
        "nodes.p",
        "as a \"test.probe\" landform, but it is a \"test.mesa\"",
    );
    // Facts of the swells (which keep none) read as mesa cells.
    let spec = base().with_node(
        "p",
        probe(
            "t.p",
            ProbeParams {
                layer: Some(Layer::Fit),
                facts_of: Some("swells".into()),
                ..Default::default()
            },
        ),
    );
    assert_refused(&spec, "nodes.p", "wrong record type");
    // The right kind reads.
    let spec = base().with_node(
        "p",
        probe(
            "t.p",
            ProbeParams {
                layer: Some(Layer::Detail),
                mesa_plans_of: Some("mesas".into()),
                ..Default::default()
            },
        ),
    );
    compile(&spec, 7, &CompileOptions::default());
}

#[test]
fn a_disabled_dependency_is_refused_unless_optional() {
    let target = probe("t.q", ProbeParams::default()).enabled(false);
    let spec = base().with_node("q", target.clone()).with_node(
        "p",
        probe(
            "t.p",
            ProbeParams {
                plans_of: Some("q".into()),
                ..Default::default()
            },
        ),
    );
    assert_refused(&spec, "nodes.p", "reads disabled node \"q\"");
    let spec = base().with_node("q", target).with_node(
        "p",
        probe(
            "t.p",
            ProbeParams {
                optional_plans_of: Some("q".into()),
                ..Default::default()
            },
        ),
    );
    let land = compile(&spec, 7, &CompileOptions::default());
    assert!(!land.dag().edges.iter().any(|e| e.from == "q"));
}

#[test]
fn undeclared_names_are_refused() {
    let p = |params: ProbeParams| base().with_node("p", probe("t.p", params));
    assert_refused(
        &p(ProbeParams {
            role: Some("rock.nonesuch".into()),
            ..Default::default()
        }),
        "nodes.p",
        "undeclared role \"rock.nonesuch\"",
    );
    assert_refused(
        &p(ProbeParams {
            zone: Some("game.nowhere".into()),
            ..Default::default()
        }),
        "nodes.p",
        "unknown zone key \"game.nowhere\"",
    );
    assert_refused(
        &p(ProbeParams {
            claim_key: Some("game.mine".into()),
            ..Default::default()
        }),
        "nodes.p",
        "undeclared claim key \"game.mine\"",
    );
    assert_refused(
        &p(ProbeParams {
            plans_of: Some("ghost".into()),
            ..Default::default()
        }),
        "nodes.p",
        "reads unknown node \"ghost\"",
    );
    // An unknown kind, enabled or not.
    let spec = base().with_node("g", NodeSpec::new("game.ghost", "t.g"));
    assert_refused(&spec, "nodes.g.kind", "unknown kind \"game.ghost\"");
    let spec = base().with_node("g", NodeSpec::new("game.ghost", "t.g").enabled(false));
    assert_refused(&spec, "nodes.g.kind", "unknown kind \"game.ghost\"");
    // Declared, the claim key resolves.
    let spec = p(ProbeParams {
        claim_key: Some("game.mine".into()),
        ..Default::default()
    })
    .with_claim_key("game.mine", ClaimKeyDecl::doc("a game bit"));
    compile(&spec, 7, &CompileOptions::default());
}

#[test]
fn a_salt_collision_is_refused() {
    // Two nodes, one salt.
    let spec = base().with_node("p", probe("proving.mesas", ProbeParams::default()));
    assert_refused(&spec, "nodes.p.salt", "already claimed by nodes.mesas.salt");
    // A node's salt against a field noise's.
    let spec = base().with_node("p", probe("plain.continent", ProbeParams::default()));
    let e = refusal(&spec);
    assert!(
        e.message.contains("\"plain.continent\" is already claimed"),
        "{e}"
    );
    // A sub-noise against another node's salt.
    let spec = base()
        .with_node(
            "p",
            probe(
                "t.p",
                ProbeParams {
                    noise: Some("x".into()),
                    ..Default::default()
                },
            ),
        )
        .with_node("q", probe("t.p.x", ProbeParams::default()));
    let e = refusal(&spec);
    assert!(e.message.contains("\"t.p.x\" is already claimed"), "{e}");
    // The engine namespace is reserved.
    let spec = base().with_node("p", probe("engine.p", ProbeParams::default()));
    assert_refused(&spec, "nodes.p.salt", "reserved");
}

#[test]
fn field_layouts_need_a_plan_and_a_bounded_gate() {
    let field = |gate: &str, with_plan: bool| {
        probe(
            "t.f",
            ProbeParams {
                layer: Some(Layer::Detail),
                field_layout: Some(FieldLayoutP {
                    gate: gate.into(),
                    with_plan,
                }),
                ..Default::default()
            },
        )
    };
    let gated = || {
        base().with_field(
            "test_gate",
            FieldDef::detail(fx::noise("t.gate", Size::Span(500.0), 2, 1.0)),
        )
    };
    let spec = gated().with_node("f", field("test_gate", false));
    assert_refused(&spec, "nodes.f", "needs field_plan()");
    // A gate with a hard select has no Lipschitz bound.
    let hard = FieldDef::detail(FieldExpr::Select {
        cond: Box::new(fx::r("hills")),
        a: Box::new(fx::c(-1.0)),
        b: Box::new(fx::c(1.0)),
        at: 0.0,
        blend: 0.0,
    });
    let spec = base()
        .with_field("hard_gate", hard)
        .with_node("f", field("hard_gate", true));
    assert_refused(&spec, "nodes.f", "no known Lipschitz bound");
    let spec = gated().with_node("f", field("test_gate", true));
    compile(&spec, 7, &CompileOptions::default());
    // A router (the plain relief's "hills") has no known bound either.
    let spec = base().with_node("f", field("hills", true));
    assert_refused(&spec, "nodes.f", "no known Lipschitz bound");
}

#[test]
fn a_spawn_reader_too_close_is_refused() {
    let reader = |layer: Layer, clear: i32| {
        probe(
            "t.r",
            ProbeParams {
                layer: Some(layer),
                spawn: Some(clear),
                ..Default::default()
            },
        )
    };
    let spec = base().with_node("r", reader(Layer::Uplift, 100));
    assert_refused(
        &spec,
        "nodes.r",
        "below the spawn search's clear_radius 256",
    );
    compile(
        &base().with_node("r", reader(Layer::Uplift, 300)),
        7,
        &CompileOptions::default(),
    );
    // Detail readers may keep less.
    let land = compile(
        &base().with_node("r", reader(Layer::Detail, 100)),
        7,
        &CompileOptions::default(),
    );
    assert_eq!(land.dag().spawn_readers, vec!["r"]);
    assert!(land.dag().spawn_excluded.contains(&"r".to_string()));
}

#[test]
fn contradictory_or_cross_layer_edges_are_refused() {
    // a over b, b over a: no order exists.
    let a = probe("t.a", ProbeParams::default()).over(&["b"]);
    let b = probe("t.b", ProbeParams::default()).over(&["a"]);
    let spec = base().with_node("a", a).with_node("b", b);
    assert_refused(
        &spec,
        "nodes.a.over",
        "contradictory over/under edges in layer Uplift",
    );
    // Edges are same-layer.
    let a = probe(
        "t.a",
        ProbeParams {
            layer: Some(Layer::Incise),
            ..Default::default()
        },
    )
    .over(&["mesas"]);
    assert_refused(
        &base().with_node("a", a),
        "nodes.a.over",
        "composition edges are same-layer",
    );
    // An edge to an unknown node.
    let a = probe("t.a", ProbeParams::default()).under(&["ghost"]);
    assert_refused(
        &base().with_node("a", a),
        "nodes.a.under",
        "names unknown node \"ghost\"",
    );
    // An edge to a disabled node is dropped: disabling never breaks a spec.
    let a = probe("t.a", ProbeParams::default()).over(&["q"]);
    let q = probe("t.q", ProbeParams::default()).enabled(false);
    compile(
        &base().with_node("a", a).with_node("q", q),
        7,
        &CompileOptions::default(),
    );
}

#[test]
fn an_enabled_site_set_is_refused_after_its_handles_validate() {
    let sites = |avoid: &str| {
        NodeSpec::new("test.sites", "t.s")
            .params(SitesParams {
                avoid: vec![avoid.into()],
            })
            .unwrap()
    };
    // Its handles are checked first.
    assert_refused(
        &base().with_node("s", sites("ghost")),
        "nodes.s",
        "unknown node",
    );
    assert_refused(
        &base().with_node("s", sites("mesas")),
        "nodes.s.kind",
        "places nothing in this build",
    );
    // Disabled, its params are typed and it compiles.
    compile(
        &base().with_node("s", sites("mesas").enabled(false)),
        7,
        &CompileOptions::default(),
    );
}

#[test]
fn game_writers_default_after_the_built_ins_with_a_lint() {
    let land = compile(
        &base().with_node("plateaus", probe("t.pl", ProbeParams::default())),
        7,
        &CompileOptions::default(),
    );
    assert_eq!(land.dag().order, vec!["mesas", "plateaus", "swells"]);
    let lint = "lint ImplicitOrder: nodes[plateaus] composes after the built-ins of layer Uplift (mesas); add \"over\" or \"under\" to place it";
    assert!(land.lints().iter().any(|l| l == lint), "{:?}", land.lints());
    let row = land
        .dag()
        .nodes
        .iter()
        .find(|n| n.id == "plateaus")
        .unwrap();
    assert_eq!(row.placed_by, "default: after built-ins (mesas)");
    // An explicit edge places it and silences the lint.
    let land = compile(
        &base().with_node(
            "plateaus",
            probe("t.pl", ProbeParams::default()).under(&["mesas"]),
        ),
        7,
        &CompileOptions::default(),
    );
    assert_eq!(land.dag().order, vec!["plateaus", "mesas", "swells"]);
    assert!(!land.lints().iter().any(|l| l.contains("ImplicitOrder")));
    // Two defaulted game nodes: after the built-ins, then by id.
    let land = compile(
        &base()
            .with_node("zeta", probe("t.z", ProbeParams::default()))
            .with_node("alpha", probe("t.al", ProbeParams::default())),
        7,
        &CompileOptions::default(),
    );
    assert_eq!(land.dag().order, vec!["mesas", "alpha", "zeta", "swells"]);
    assert_eq!(
        land.lints()
            .iter()
            .filter(|l| l.contains("ImplicitOrder"))
            .count(),
        2
    );
    // Alone in its layer, a game node needs no edge and gets no lint.
    let land = compile(&proving_spec(256), 7, &CompileOptions::default());
    assert!(!land.lints().iter().any(|l| l.contains("ImplicitOrder")));
}

#[test]
fn composition_order_is_independent_of_the_dag() {
    // An Uplift node that reads the plans of an Incise node at plan time
    // still composes before it.
    let spec = proving_spec(256)
        .with_node(
            "cut",
            probe(
                "t.cut",
                ProbeParams {
                    layer: Some(Layer::Incise),
                    ..Default::default()
                },
            ),
        )
        .with_node(
            "watch",
            probe(
                "t.w",
                ProbeParams {
                    layer: Some(Layer::Uplift),
                    plans_of: Some("cut".into()),
                    ..Default::default()
                },
            ),
        );
    let land = compile(&spec, 7, &CompileOptions::default());
    let order = &land.dag().order;
    let pos = |id: &str| order.iter().position(|o| o == id).unwrap();
    assert!(pos("watch") < pos("cut"));
    assert!(pos("mesas") < pos("sinkholes"));
    assert!(land
        .dag()
        .edges
        .iter()
        .any(|e| e.from == "cut" && e.to == "watch" && e.handle == "plans"));
    // But a plan-time read of a node that probes through the reader's
    // layer is a cycle: the sinkholes probe every Uplift writer.
    let spec = proving_spec(256).with_node(
        "watch",
        probe(
            "t.w",
            ProbeParams {
                layer: Some(Layer::Uplift),
                occupancy_of: vec!["sinkholes".into()],
                ..Default::default()
            },
        ),
    );
    assert!(refusal(&spec)
        .message
        .contains("sinkholes → watch → sinkholes"));
}

#[test]
fn typed_params_hash_alike_and_disabled_nodes_stamp_identity() {
    let a = compile(&base(), 7, &CompileOptions::default());
    // The same params with a spelled-out float hash the same.
    let mut spec = base();
    let node = spec.nodes.get_mut("mesas").unwrap();
    node.params["round"] = serde_json::json!(4);
    let b = compile(&spec, 7, &CompileOptions::default());
    assert_eq!(a.identity().spec_hash, b.identity().spec_hash);
    // Disabled, a node still stamps its kind and changes the hash.
    let mut spec = base();
    spec.nodes.get_mut("mesas").unwrap().enabled = false;
    let c = compile(&spec, 7, &CompileOptions::default());
    assert_ne!(a.identity().spec_hash, c.identity().spec_hash);
    assert!(c.identity().kinds.iter().any(|k| k.kind == "test.mesa"));
    // Provinces join their owner's stamp.
    let d = compile(&proving_spec(256), 7, &CompileOptions::default());
    let stamp = d
        .identity()
        .kinds
        .iter()
        .find(|k| k.kind == "game.sinkhole")
        .unwrap();
    assert_eq!(
        stamp.provinces,
        vec![("game.sinkhole.notch".to_string(), 1)]
    );
    let _ = mesa_node();
}
