//! Spawn is a declared DAG node, `engine.spawn`: it composes every ground
//! writer below the Water layer except the spawn readers (and their
//! dependents), verifies the first candidate through the Detail layer
//! (dry, calm, no ROCK, HYDRO or NO_SITES), and readers keep their
//! clearance or their plans are rejected.

#[path = "fixtures/kinds.rs"]
mod kinds;
#[path = "fixtures/landscape.rs"]
mod land;
#[path = "../examples/sinkhole.rs"]
mod sinkhole;

use kinds::*;
use voxelize_gen::landscape::prelude::*;
use voxelize_gen::landscape::{CompileOptions, SpawnOutcome};

const H: u32 = 256;

fn disc_at(
    layer: Layer,
    center: (f64, f64),
    claims: Claims,
    spawn_clear: Option<i32>,
) -> DiscParams {
    DiscParams {
        layer,
        center,
        radius: 20.0,
        fade: 8.0,
        lift: 0.0,
        exclusive: false,
        claims: claims.0,
        span: None,
        spawn_clear,
    }
}

#[test]
fn spawn_is_a_declared_node() {
    let land = compile(&proving_spec(H), 7, &CompileOptions::default());
    let dag = land.dag();
    for id in ["mesas", "sinkholes", "swells"] {
        assert!(
            dag.edges
                .iter()
                .any(|e| e.from == id && e.to == "engine.spawn"),
            "the spawn search reads {id}"
        );
    }
    let (x, y, z) = land.spawn_point();
    assert_eq!(y, land.column(x, z, Tier::Full).top + 1);
    assert!(matches!(
        land.spawn_report().outcome,
        SpawnOutcome::Found { .. }
    ));
}

#[test]
fn a_detail_landform_on_the_first_candidate_moves_spawn() {
    let plain = land::plain(7, H, &CompileOptions::default());
    let first = plain.spawn();
    let SpawnOutcome::Found { tested } = plain.spawn_report().outcome else {
        panic!("plain finds a spawn");
    };
    // A Detail disc claiming NO_SITES over the first candidate: the shape
    // search (below Water) cannot see it, the verification (through
    // Detail) rejects the candidate, and spawn moves on.
    let spec = land::plain_spec(H).with_node(
        "marker",
        disc(
            "t.marker",
            disc_at(
                Layer::Detail,
                (first.0 as f64 + 0.5, first.1 as f64 + 0.5),
                Claims::NO_SITES,
                None,
            ),
        ),
    );
    let land = compile(&spec, 7, &CompileOptions::default());
    let report = land.spawn_report();
    assert_ne!(
        report.column, first,
        "spawn should move off the claimed candidate"
    );
    let SpawnOutcome::Found { tested: now } = report.outcome else {
        panic!("a spawn is still found");
    };
    assert!(
        now > tested,
        "{now} candidates tested, first found after {tested}"
    );
    // The new spawn is dry, calm and unclaimed in the final state.
    let c = land.column(report.column.0, report.column.1, Tier::Full);
    assert!(c.water.is_dry());
    assert!(c
        .claims
        .iter()
        .all(|e| e.weight == 0.0 || (e.bit != 0 && e.bit != 1 && e.bit != 4)));
}

#[test]
fn spawn_readers_are_excluded_and_keep_clear() {
    let plain = land::plain(7, H, &CompileOptions::default());
    let first = plain.spawn();
    // A Detail reader right on spawn: excluded from the search (spawn does
    // not move), and its plan comes within its clearance, so it is
    // rejected and counted.
    let near = land::plain_spec(H).with_node(
        "hero",
        disc(
            "t.hero",
            disc_at(
                Layer::Detail,
                (first.0 as f64 + 0.5, first.1 as f64 + 0.5),
                Claims::NO_SITES,
                Some(64),
            ),
        ),
    );
    let land = compile(&near, 7, &CompileOptions::default());
    assert_eq!(land.dag().spawn_readers, vec!["hero"]);
    assert!(land.dag().spawn_excluded.contains(&"hero".to_string()));
    assert_eq!(land.spawn(), first, "a reader never moves spawn");
    let area = Aabb2::around(first.0 as f64, first.1 as f64, 400.0);
    assert!(land.instances_in(area).iter().all(|i| i.node != "hero"));
    let stats = land.plan_stats();
    let hero = stats.iter().find(|s| s.node == "hero").unwrap();
    assert_eq!(hero.rejected_spawn, 1);
    // Far enough away, the reader's plan stands.
    let far = land::plain_spec(H).with_node(
        "hero",
        disc(
            "t.hero",
            disc_at(
                Layer::Detail,
                (first.0 as f64 + 200.5, first.1 as f64 + 0.5),
                Claims::NO_SITES,
                Some(64),
            ),
        ),
    );
    let land = compile(&far, 7, &CompileOptions::default());
    assert_eq!(land.spawn(), first);
    assert!(land.instances_in(area).iter().any(|i| i.node == "hero"));
    // Everything that depends on a reader is excluded too.
    let chained = far.with_node(
        "follower",
        probe(
            "t.follower",
            ProbeParams {
                layer: Some(Layer::Fit),
                occupancy_of: vec!["hero".into()],
                ..Default::default()
            },
        ),
    );
    let land = compile(&chained, 7, &CompileOptions::default());
    assert!(land.dag().spawn_excluded.contains(&"follower".to_string()));
}
