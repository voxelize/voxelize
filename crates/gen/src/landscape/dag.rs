//! The planner DAG and the composition order.
//!
//! **The DAG is recorded, never declared.** Every handle a node acquired
//! from `BuildCtx` is an edge: a node reads another node's plans,
//! occupancy or facts, composed ground through a set of nodes (a probe),
//! or the spawn anchor. The spawn search is itself a node,
//! `engine.spawn`: it reads every ground writer up to the Detail layer
//! except the spawn readers and everything that depends on them, and the
//! readers read it.
//!
//! **Composition order is independent of the DAG**: by layer, then within
//! a layer a topological order of the explicit `over`/`under` edges, ties
//! broken by (built-in rank, then game nodes, then node id). A game node
//! with no edge composes after every built-in of its layer (the default
//! "after built-ins" order), and compile prints the `ImplicitOrder` lint
//! naming it. So a canyon (Incise) always composes over a range (Uplift),
//! even when the range reads canyon occupancy at plan time.
//!
//! **Refusals** (each path-qualified): a cycle, printed node by node with a
//! suggested fix; a probe through the reader's own or a later layer; a
//! same-layer `Through::With` read or fact read of a node that does not
//! compose strictly earlier (an explicit `over` path); contradictory or
//! cross-layer `over`/`under` edges, or edges to unknown nodes; a spawn
//! reader in Uplift, Incise or Shore keeping less than the spawn search's
//! clearance.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use super::build::{Read, ThroughRec};
use super::plugin::Layer;
use super::registry::NodeClass;
use super::spec::SpecError;

/// The name of the spawn node.
pub const SPAWN_NODE: &str = "engine.spawn";

/// One node as the DAG sees it.
#[derive(Clone, Debug)]
pub(crate) struct DagInput {
    pub idx: u16,
    pub id: String,
    pub kind: String,
    pub class: NodeClass,
    pub layer: Layer,
    pub builtin: Option<u32>,
    pub over: Vec<String>,
    pub under: Vec<String>,
    pub reads: Vec<(Read, &'static str)>,
}

/// One node in the compiled DAG.
#[derive(Clone, Debug, serde::Serialize)]
pub struct DagNode {
    /// Node id.
    pub id: String,
    /// Kind key.
    pub kind: String,
    /// Layer name.
    pub layer: String,
    /// `landform`, `region` or `site_set`.
    pub class: String,
    /// The engine's default rank, for built-ins.
    pub builtin: Option<u32>,
    /// Position in the composition order (ground writers only).
    pub rank: Option<u16>,
    /// The rule that placed it in the composition order.
    pub placed_by: String,
}

/// One recorded edge: `to` reads `from` through `handle`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
pub struct DagEdge {
    /// What is read: a node id, `field:<name>` or `engine.spawn`.
    pub from: String,
    /// The reader: a node id or `engine.spawn`.
    pub to: String,
    /// The handle that recorded it (`plans`, `probe Layer(Incise)`, ...).
    pub handle: String,
}

/// The planner DAG and the composition order of one compiled landscape.
#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct Dag {
    /// Enabled nodes, by id.
    pub nodes: Vec<DagNode>,
    /// Every recorded edge, sorted.
    pub edges: Vec<DagEdge>,
    /// Ground writers in composition order, by id.
    pub order: Vec<String>,
    /// Spawn readers (they read `engine.spawn`).
    pub spawn_readers: Vec<String>,
    /// Nodes the spawn search never sees: the readers and everything
    /// that depends on them.
    pub spawn_excluded: Vec<String>,
    /// Compile lints from the order.
    pub lints: Vec<String>,
}

/// What the DAG resolved for compile.
pub(crate) struct Resolved {
    pub dag: Dag,
    /// Ground writers (landforms, region solvers) in composition order.
    pub order: Vec<u16>,
    /// Node-to-node dependencies: `deps[n]` are the nodes `n` reads.
    pub deps: BTreeMap<u16, BTreeSet<u16>>,
    /// Nodes the spawn search composes (ground writers up to Detail, minus
    /// the readers' closure).
    pub spawn_set: Vec<u16>,
    /// Spawn readers and their clearance.
    pub spawn_readers: Vec<(u16, i32)>,
}

fn class_name(c: NodeClass) -> &'static str {
    match c {
        NodeClass::Landform => "landform",
        NodeClass::Region => "region",
        NodeClass::SiteSet => "site_set",
    }
}

fn writes_ground(c: NodeClass) -> bool {
    matches!(c, NodeClass::Landform | NodeClass::Region)
}

/// Whether `from` reaches `to` through explicit edges `(before, after)`
/// read as "after composes after before": `from` composes after `to`.
fn composes_after(edges: &BTreeSet<(u16, u16)>, from: u16, to: u16) -> bool {
    let mut stack = vec![from];
    let mut seen = BTreeSet::new();
    while let Some(n) = stack.pop() {
        if !seen.insert(n) {
            continue;
        }
        for &(before, after) in edges {
            if after == n {
                if before == to {
                    return true;
                }
                stack.push(before);
            }
        }
    }
    false
}

/// Build the DAG for the enabled nodes `inputs`. `node_ids` holds every
/// spec node id (enabled or not) in index order; `enabled[i]` says which.
pub(crate) fn resolve(
    inputs: &[DagInput],
    node_ids: &[String],
    enabled: &[bool],
    spawn_clear: Option<i32>,
) -> Result<Resolved, SpecError> {
    let by_idx: BTreeMap<u16, &DagInput> = inputs.iter().map(|n| (n.idx, n)).collect();
    let id_of = |i: u16| node_ids[i as usize].as_str();

    // Explicit composition edges (before, after), same layer only.
    let mut explicit: BTreeSet<(u16, u16)> = BTreeSet::new();
    for n in inputs {
        for (field, targets, is_over) in [("over", &n.over, true), ("under", &n.under, false)] {
            for t in targets {
                let path = format!("nodes.{}.{field}", n.id);
                let Some(ti) = node_ids.iter().position(|x| x == t) else {
                    return Err(SpecError::new(path, format!("names unknown node {t:?}")));
                };
                let ti = ti as u16;
                if ti == n.idx {
                    return Err(SpecError::new(
                        path,
                        "a node cannot compose over or under itself",
                    ));
                }
                if !enabled[ti as usize] {
                    // Disabling a node leaves the specs that order against
                    // it valid.
                    continue;
                }
                let target = by_idx[&ti];
                if target.layer != n.layer {
                    return Err(SpecError::new(
                        path,
                        format!(
                            "composition edges are same-layer: {} is {} but {t:?} is {}",
                            n.id,
                            n.layer.name(),
                            target.layer.name()
                        ),
                    ));
                }
                if is_over {
                    explicit.insert((ti, n.idx));
                } else {
                    explicit.insert((n.idx, ti));
                }
            }
        }
    }

    // Composition order, layer by layer.
    let mut order: Vec<u16> = Vec::new();
    let mut placed_by: BTreeMap<u16, String> = BTreeMap::new();
    let mut lints = Vec::new();
    for layer in Layer::ALL {
        let members: Vec<&DagInput> = inputs.iter().filter(|n| n.layer == layer).collect();
        if members.is_empty() {
            continue;
        }
        let in_layer: BTreeSet<u16> = members.iter().map(|n| n.idx).collect();
        let declared: BTreeSet<(u16, u16)> = explicit
            .iter()
            .copied()
            .filter(|(a, b)| in_layer.contains(a) && in_layer.contains(b))
            .collect();
        let has_edge = |i: u16| declared.iter().any(|&(a, b)| a == i || b == i);
        let mut edges = declared.clone();
        let builtins: Vec<&DagInput> = {
            let mut b: Vec<&DagInput> = members
                .iter()
                .copied()
                .filter(|n| n.builtin.is_some())
                .collect();
            b.sort_by_key(|n| (n.builtin, n.id.clone()));
            b
        };
        let builtin_names: Vec<String> = builtins.iter().map(|n| n.id.clone()).collect();
        let mut defaulted = Vec::new();
        for n in &members {
            if n.builtin.is_none() && !has_edge(n.idx) {
                defaulted.push(n.idx);
            }
        }
        for &g in &defaulted {
            for b in &builtins {
                edges.insert((b.idx, g));
            }
        }
        for n in &members {
            let rule = if let Some(r) = n.builtin {
                if has_edge(n.idx) {
                    format!(
                        "built-in rank {r}, with edges over {:?} under {:?}",
                        n.over, n.under
                    )
                } else {
                    format!("built-in rank {r}")
                }
            } else if defaulted.contains(&n.idx) {
                if builtins.is_empty() {
                    "default: game node, by id".to_string()
                } else {
                    format!("default: after built-ins ({})", builtin_names.join(", "))
                }
            } else {
                format!("edge: over {:?} under {:?}", n.over, n.under)
            };
            placed_by.insert(n.idx, rule);
            if defaulted.contains(&n.idx) && writes_ground(n.class) && members.len() > 1 {
                lints.push(format!(
                    "lint ImplicitOrder: nodes[{}] composes after the built-ins of layer {} ({}); add \"over\" or \"under\" to place it",
                    n.id,
                    layer.name(),
                    if builtin_names.is_empty() {
                        "none; by id among game nodes".to_string()
                    } else {
                        builtin_names.join(", ")
                    }
                ));
            }
        }
        // Kahn's algorithm with ties by (game, built-in rank, id).
        let key = |i: u16| {
            let n = by_idx[&i];
            (n.builtin.is_none(), n.builtin.unwrap_or(0), n.id.clone(), i)
        };
        let mut indegree: BTreeMap<u16, usize> = in_layer.iter().map(|&i| (i, 0)).collect();
        for &(_, b) in &edges {
            *indegree.get_mut(&b).unwrap() += 1;
        }
        let mut ready: BTreeSet<(bool, u32, String, u16)> = indegree
            .iter()
            .filter(|(_, &d)| d == 0)
            .map(|(&i, _)| key(i))
            .collect();
        let mut placed = Vec::new();
        while let Some(k) = ready.pop_first() {
            let i = k.3;
            placed.push(i);
            for &(a, b) in &edges {
                if a == i {
                    let d = indegree.get_mut(&b).unwrap();
                    *d -= 1;
                    if *d == 0 {
                        ready.insert(key(b));
                    }
                }
            }
        }
        if placed.len() < in_layer.len() {
            let stuck: Vec<String> = in_layer
                .iter()
                .filter(|i| !placed.contains(i))
                .map(|&i| id_of(i).to_string())
                .collect();
            return Err(SpecError::new(
                format!("nodes.{}.over", stuck[0]),
                format!(
                    "contradictory over/under edges in layer {}: {} cannot be ordered (each must compose after another); remove one edge",
                    layer.name(),
                    stuck.join(", ")
                ),
            ));
        }
        order.extend(placed);
    }
    let ground_order: Vec<u16> = order
        .iter()
        .copied()
        .filter(|i| writes_ground(by_idx[i].class))
        .collect();
    let rank_of: BTreeMap<u16, u16> = ground_order
        .iter()
        .enumerate()
        .map(|(r, &i)| (i, r as u16))
        .collect();

    // Node dependencies and read rules.
    let mut deps: BTreeMap<u16, BTreeSet<u16>> =
        inputs.iter().map(|n| (n.idx, BTreeSet::new())).collect();
    let mut edges_out: BTreeSet<DagEdge> = BTreeSet::new();
    let mut spawn_readers: Vec<(u16, i32)> = Vec::new();
    let strictly_earlier = |reader: &DagInput, target: u16| -> bool {
        let t = by_idx[&target];
        t.layer < reader.layer
            || (t.layer == reader.layer && composes_after(&explicit, reader.idx, target))
    };
    for n in inputs {
        let path = format!("nodes.{}", n.id);
        for (read, handle) in &n.reads {
            match read {
                Read::Field(name) => {
                    edges_out.insert(DagEdge {
                        from: format!("field:{name}"),
                        to: n.id.clone(),
                        handle: handle.to_string(),
                    });
                }
                Read::Plans { node, .. } | Read::Fact(node) => {
                    if let Read::Fact(_) = read {
                        if !strictly_earlier(n, *node) {
                            return Err(SpecError::new(
                                path,
                                format!(
                                    "reads the facts of {:?}, which does not compose strictly earlier (an earlier layer, or this layer with an explicit \"over\" path from {} to it)",
                                    id_of(*node),
                                    n.id
                                ),
                            ));
                        }
                    }
                    deps.get_mut(&n.idx).unwrap().insert(*node);
                    edges_out.insert(DagEdge {
                        from: id_of(*node).to_string(),
                        to: n.id.clone(),
                        handle: handle.to_string(),
                    });
                }
                Read::Occupancy(nodes) => {
                    for &t in nodes {
                        deps.get_mut(&n.idx).unwrap().insert(t);
                        edges_out.insert(DagEdge {
                            from: id_of(t).to_string(),
                            to: n.id.clone(),
                            handle: handle.to_string(),
                        });
                    }
                }
                Read::Probe(through) => {
                    let label = match through {
                        ThroughRec::Macro => "probe Macro".to_string(),
                        ThroughRec::Layer(l) => format!("probe Layer({})", l.name()),
                        ThroughRec::With(_) => "probe With".to_string(),
                    };
                    let members: Vec<u16> = match through {
                        ThroughRec::Macro => Vec::new(),
                        ThroughRec::Layer(l) => {
                            if *l > n.layer {
                                return Err(SpecError::new(
                                    path,
                                    format!(
                                        "probes Through::Layer({}), which includes its own layer {} (probes see only layers strictly below the one named, at most the reader's own)",
                                        l.name(),
                                        n.layer.name()
                                    ),
                                ));
                            }
                            ground_order
                                .iter()
                                .copied()
                                .filter(|i| by_idx[i].layer < *l)
                                .collect()
                        }
                        ThroughRec::With(nodes) => {
                            for &t in nodes {
                                if !writes_ground(by_idx[&t].class) {
                                    return Err(SpecError::new(
                                        path,
                                        format!(
                                            "probes through {:?}, which writes no ground",
                                            id_of(t)
                                        ),
                                    ));
                                }
                                if !strictly_earlier(n, t) {
                                    return Err(SpecError::new(
                                        path,
                                        format!(
                                            "probes through {:?}, which does not compose strictly earlier (an earlier layer, or this layer with an explicit \"over\" path from {} to it)",
                                            id_of(t),
                                            n.id
                                        ),
                                    ));
                                }
                            }
                            nodes.clone()
                        }
                    };
                    for t in members {
                        deps.get_mut(&n.idx).unwrap().insert(t);
                        edges_out.insert(DagEdge {
                            from: id_of(t).to_string(),
                            to: n.id.clone(),
                            handle: label.clone(),
                        });
                    }
                }
                Read::Spawn(clear) => {
                    if let Some(radius) = spawn_clear {
                        if n.layer <= Layer::Shore && *clear < radius {
                            return Err(SpecError::new(
                                path,
                                format!(
                                    "reads spawn with clear {clear} in layer {}, below the spawn search's clear_radius {radius} (readers in Uplift, Incise and Shore must keep at least that)",
                                    n.layer.name()
                                ),
                            ));
                        }
                    }
                    match spawn_readers.iter_mut().find(|(i, _)| *i == n.idx) {
                        Some(r) => r.1 = Ord::max(r.1, *clear),
                        None => spawn_readers.push((n.idx, *clear)),
                    }
                    edges_out.insert(DagEdge {
                        from: SPAWN_NODE.to_string(),
                        to: n.id.clone(),
                        handle: format!("spawn(clear {clear})"),
                    });
                }
                Read::Role(_)
                | Read::Zone(_)
                | Read::ClaimKey(_)
                | Read::Noise(_)
                | Read::Province(_) => {}
            }
        }
    }

    // Cycles.
    if let Some(cycle) = find_cycle(&deps) {
        let names: Vec<String> = cycle.iter().map(|&i| id_of(i).to_string()).collect();
        return Err(SpecError::new(
            format!("nodes.{}", names[0]),
            format!(
                "planner cycle: {} (each reads the next); break it by reading one of them Through::Macro, through a lower layer, or by occupancy only",
                names.join(" → ")
            ),
        ));
    }

    // Spawn: readers and everything that depends on them are excluded.
    let mut excluded: BTreeSet<u16> = spawn_readers.iter().map(|(i, _)| *i).collect();
    loop {
        let before = excluded.len();
        for (n, ds) in &deps {
            if ds.iter().any(|d| excluded.contains(d)) {
                excluded.insert(*n);
            }
        }
        if excluded.len() == before {
            break;
        }
    }
    let spawn_set: Vec<u16> = ground_order
        .iter()
        .copied()
        .filter(|i| by_idx[i].layer <= Layer::Detail && !excluded.contains(i))
        .collect();
    for &i in &spawn_set {
        edges_out.insert(DagEdge {
            from: id_of(i).to_string(),
            to: SPAWN_NODE.to_string(),
            handle: "spawn search".to_string(),
        });
    }

    let nodes: Vec<DagNode> = {
        let mut v: Vec<DagNode> = inputs
            .iter()
            .map(|n| DagNode {
                id: n.id.clone(),
                kind: n.kind.clone(),
                layer: n.layer.name().to_string(),
                class: class_name(n.class).to_string(),
                builtin: n.builtin,
                rank: rank_of.get(&n.idx).copied(),
                placed_by: placed_by.get(&n.idx).cloned().unwrap_or_default(),
            })
            .collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    };
    lints.sort();
    let dag = Dag {
        nodes,
        edges: edges_out.into_iter().collect(),
        order: ground_order.iter().map(|&i| id_of(i).to_string()).collect(),
        spawn_readers: spawn_readers
            .iter()
            .map(|(i, _)| id_of(*i).to_string())
            .collect(),
        spawn_excluded: excluded.iter().map(|&i| id_of(i).to_string()).collect(),
        lints,
    };
    Ok(Resolved {
        dag,
        order: ground_order,
        deps,
        spawn_set,
        spawn_readers,
    })
}

/// A cycle in `deps` (each node reads the next), if any, starting at its
/// smallest node.
fn find_cycle(deps: &BTreeMap<u16, BTreeSet<u16>>) -> Option<Vec<u16>> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        New,
        Open,
        Done,
    }
    let mut mark: BTreeMap<u16, Mark> = deps.keys().map(|&k| (k, Mark::New)).collect();
    fn visit(
        n: u16,
        deps: &BTreeMap<u16, BTreeSet<u16>>,
        mark: &mut BTreeMap<u16, Mark>,
        stack: &mut Vec<u16>,
    ) -> Option<Vec<u16>> {
        mark.insert(n, Mark::Open);
        stack.push(n);
        for &d in deps.get(&n).into_iter().flatten() {
            match mark.get(&d).copied().unwrap_or(Mark::Done) {
                Mark::Open => {
                    let at = stack.iter().position(|&s| s == d).unwrap();
                    let mut cycle: Vec<u16> = stack[at..].to_vec();
                    cycle.push(d);
                    return Some(cycle);
                }
                Mark::New => {
                    if let Some(c) = visit(d, deps, mark, stack) {
                        return Some(c);
                    }
                }
                Mark::Done => {}
            }
        }
        stack.pop();
        mark.insert(n, Mark::Done);
        None
    }
    let keys: Vec<u16> = deps.keys().copied().collect();
    for k in keys {
        if mark[&k] == Mark::New {
            let mut stack = Vec::new();
            if let Some(c) = visit(k, deps, &mut mark, &mut stack) {
                return Some(c);
            }
        }
    }
    None
}

impl Dag {
    /// The DAG and the composition order as text (`landscape_render
    /// --dag`).
    pub fn to_text(&self) -> String {
        let mut s = String::new();
        let _ = writeln!(
            s,
            "planner DAG: {} node(s), {} edge(s)",
            self.nodes.len(),
            self.edges.len()
        );
        let _ = writeln!(s, "  edges (reader <- what it reads, handle):");
        for e in &self.edges {
            let _ = writeln!(s, "    {:<20} <- {:<28} [{}]", e.to, e.from, e.handle);
        }
        let _ = writeln!(s, "  spawn node: {SPAWN_NODE}");
        let _ = writeln!(
            s,
            "    readers: {}",
            if self.spawn_readers.is_empty() {
                "none".to_string()
            } else {
                self.spawn_readers.join(", ")
            }
        );
        let _ = writeln!(
            s,
            "    excluded from the search: {}",
            if self.spawn_excluded.is_empty() {
                "none".to_string()
            } else {
                self.spawn_excluded.join(", ")
            }
        );
        let _ = writeln!(s, "composition order:");
        for layer in Layer::ALL {
            let mut rows: Vec<&DagNode> = self
                .nodes
                .iter()
                .filter(|n| n.layer == layer.name())
                .collect();
            if rows.is_empty() {
                continue;
            }
            rows.sort_by_key(|n| (n.rank.unwrap_or(u16::MAX), n.id.clone()));
            let _ = writeln!(s, "  {}:", layer.name());
            for n in rows {
                let _ = writeln!(
                    s,
                    "    {} {} ({} {}): {}",
                    n.rank.map_or("-".to_string(), |r| format!("{r:>2}.")),
                    n.id,
                    n.class,
                    n.kind,
                    n.placed_by
                );
            }
        }
        for l in &self.lints {
            let _ = writeln!(s, "{l}");
        }
        s
    }

    /// The DAG as Graphviz.
    pub fn to_dot(&self) -> String {
        let mut s = String::from(
            "digraph landscape {\n  rankdir=LR;\n  node [shape=box, fontname=\"Helvetica\"];\n",
        );
        let _ = writeln!(s, "  \"{SPAWN_NODE}\" [shape=ellipse];");
        for n in &self.nodes {
            let _ = writeln!(
                s,
                "  \"{}\" [label=\"{}\\n{} {}\"];",
                n.id, n.id, n.layer, n.kind
            );
        }
        for e in &self.edges {
            if e.from.starts_with("field:") {
                let _ = writeln!(s, "  \"{}\" [shape=note];", e.from);
            }
            let _ = writeln!(
                s,
                "  \"{}\" -> \"{}\" [label=\"{}\"];",
                e.from, e.to, e.handle
            );
        }
        s.push_str("}\n");
        s
    }
}
