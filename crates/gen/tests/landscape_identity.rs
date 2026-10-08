//! Identity verdicts and the identity file's lifecycle: written next to the
//! chunks on a fresh world, identical across restarts, refused or warned on
//! drift only when saved chunks could seam, removed by `Chunks::wipe`, and
//! invisible to `.json` chunk enumeration.

#[path = "fixtures/landscape.rs"]
mod land;

use std::path::PathBuf;

use voxelize::{Chunks, WorldConfig};
use voxelize_gen::landscape::identity::{DRIFT_LOG, IDENTITY_FILE};
use voxelize_gen::landscape::{
    Compat, CompileOptions, DriftPolicy, IdentityFile, KindStamp, LandscapeIdentity,
};

fn identity() -> LandscapeIdentity {
    land::plain(7, 256, &CompileOptions::default())
        .identity()
        .clone()
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "voxelize-gen-identity-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn verdicts_name_the_most_severe_difference() {
    let a = identity();
    assert_eq!(a.compare(&a), Compat::Identical);
    let mut b = a.clone();
    b.spec_hash ^= 1;
    assert_eq!(a.compare(&b), Compat::ContentDrift);
    let mut b = a.clone();
    b.content_version.minor += 1;
    assert_eq!(a.compare(&b), Compat::ContentDrift);
    let mut b = a.clone();
    b.algo += 1;
    assert_eq!(a.compare(&b), Compat::AlgoDrift);
    let mut b = a.clone();
    b.canon += 1;
    assert_eq!(a.compare(&b), Compat::AlgoDrift);
    let mut b = a.clone();
    b.kinds.push(KindStamp {
        kind: "game.extra".into(),
        version: 1,
        provinces: vec![],
    });
    assert_eq!(a.compare(&b), Compat::KindDrift);
    let mut b = a.clone();
    b.roles_digest ^= 1;
    assert_eq!(a.compare(&b), Compat::RoleDrift);
    let mut b = a.clone();
    b.format = 3;
    assert_eq!(a.compare(&b), Compat::FormatDrift);
    let mut b = a.clone();
    b.world_seed += 1;
    assert_eq!(a.compare(&b), Compat::DifferentSeed);
    let mut b = a.clone();
    b.preset = "other".into();
    b.spec_hash ^= 1;
    assert_eq!(a.compare(&b), Compat::DifferentPreset);
    // A role binding change shows in the identity.
    let other = voxelize_gen::landscape::compile(
        &land::plain_spec(256),
        &voxelize_gen::landscape::KindRegistry::with_builtins(),
        &voxelize_gen::landscape::RoleBinding::demo().block("snow", "Ice"),
        &land::demo_registry(),
        &land::config(7, 256),
    )
    .unwrap();
    assert_eq!(a.compare(other.identity()), Compat::RoleDrift);
}

#[test]
fn file_lifecycle() {
    let dir = scratch("lifecycle");
    let chunks = dir.join("chunks");
    let id = identity();
    // Fresh: written, identical.
    let r = IdentityFile::check_dir(&chunks, &id, DriftPolicy::Refuse).unwrap();
    assert_eq!(
        (r.verdict, r.wrote, r.saved_chunks),
        (Compat::Identical, true, 0)
    );
    assert!(chunks.join(IDENTITY_FILE).exists());
    // A restart: identical, not rewritten.
    let r = IdentityFile::check_dir(&chunks, &id, DriftPolicy::Refuse).unwrap();
    assert_eq!((r.verdict, r.wrote), (Compat::Identical, false));
    // Drift with no saved chunk: nothing can seam, rewritten silently.
    let mut drifted = id.clone();
    drifted.spec_hash ^= 0xff;
    let r = IdentityFile::check_dir(&chunks, &drifted, DriftPolicy::Refuse).unwrap();
    assert_eq!((r.verdict, r.wrote), (Compat::ContentDrift, true));
    assert!(!chunks.join(DRIFT_LOG).exists());
    // A saved chunk appears: drift now refuses...
    std::fs::write(chunks.join("0x0.json"), "{}").unwrap();
    let e = IdentityFile::check_dir(&chunks, &id, DriftPolicy::Refuse).unwrap_err();
    assert!(e.to_string().contains("ContentDrift"), "{e}");
    // ...warns and logs...
    let r = IdentityFile::check_dir(&chunks, &id, DriftPolicy::Warn).unwrap();
    assert_eq!(
        (r.verdict, r.saved_chunks, r.wrote),
        (Compat::ContentDrift, 1, true)
    );
    let log = std::fs::read_to_string(chunks.join(DRIFT_LOG)).unwrap();
    assert!(log.contains("ContentDrift saved_chunks=1"));
    // ...and is identical afterwards.
    let r = IdentityFile::check_dir(&chunks, &id, DriftPolicy::Refuse).unwrap();
    assert_eq!(r.verdict, Compat::Identical);
    // A missing identity beside saved chunks is Unknown, which is drift.
    std::fs::remove_file(chunks.join(IDENTITY_FILE)).unwrap();
    let e = IdentityFile::check_dir(&chunks, &id, DriftPolicy::Refuse).unwrap_err();
    assert!(e.to_string().contains("Unknown"), "{e}");
    let r = IdentityFile::check_dir(&chunks, &id, DriftPolicy::Allow).unwrap();
    assert_eq!(r.verdict, Compat::Unknown);
    // An unreadable identity is Unknown too.
    std::fs::write(chunks.join(IDENTITY_FILE), "{not json").unwrap();
    let r = IdentityFile::check_dir(&chunks, &id, DriftPolicy::Allow).unwrap();
    assert_eq!(r.verdict, Compat::Unknown);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn identity_lives_in_the_chunks_folder_and_wipe_removes_it() {
    let dir = scratch("wipe");
    let config = WorldConfig::new()
        .seed(7)
        .max_height(256)
        .saving(true)
        .save_dir(dir.to_str().unwrap())
        .build();
    let id = identity();
    assert_eq!(
        IdentityFile::check_or_write(&config, &id, DriftPolicy::Refuse).unwrap(),
        Compat::Identical
    );
    let chunks_dir = IdentityFile::chunks_dir(&config).unwrap();
    assert_eq!(chunks_dir, dir.join("chunks"));
    let file = chunks_dir.join(IDENTITY_FILE);
    assert!(file.exists());
    // Not a chunk file to anything that enumerates `.json`.
    assert_ne!(file.extension().and_then(|e| e.to_str()), Some("json"));
    let json_files = std::fs::read_dir(&chunks_dir)
        .unwrap()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .count();
    assert_eq!(json_files, 0);
    // The engine's wipe resets chunks and identity together.
    let mut manager = Chunks::new(&config);
    manager.wipe();
    assert!(!file.exists(), "Chunks::wipe left the identity behind");
    // A clean regenerate never trips Refuse.
    assert_eq!(
        IdentityFile::check_or_write(&config, &id, DriftPolicy::Refuse).unwrap(),
        Compat::Identical
    );
    // A world that does not save has nothing to check.
    let unsaved = WorldConfig::new().seed(7).max_height(256).build();
    assert!(IdentityFile::chunks_dir(&unsaved).is_none());
    assert_eq!(
        IdentityFile::check_or_write(&unsaved, &id, DriftPolicy::Refuse).unwrap(),
        Compat::Identical
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn identity_file_is_canonical_and_reads_back() {
    let id = identity();
    let text = id.to_file_text();
    let back: LandscapeIdentity = voxelize_gen::landscape::json::from_str(&text).unwrap();
    assert_eq!(back, id);
    assert!(text.ends_with('\n') && !text[..text.len() - 1].contains('\n'));
}
