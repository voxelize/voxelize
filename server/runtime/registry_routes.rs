//! The server's block registry over HTTP, byte for byte the text INIT carries,
//! so a page can fetch it while it loads and JOIN naming its digest (the INIT
//! then leaves the registry out).
//!
//! - `GET /registry/blocks.json`: the current registry, revalidated on every
//!   use (`Cache-Control: no-cache`, `ETag: W/"<digest>"`, 304 on a match).
//! - `GET /registry/blocks.<digest>.json`: that exact registry, cacheable
//!   forever; any other digest is a 404.
//!
//! Both answer from memory and never message a world or the server actor.
//! The body is exactly [`InitRegistry::blocks`] and the `X-Registry-Digest`
//! header exactly [`InitRegistry::digest`]: a client keeps that text and
//! sends that digest as is. The registry is serialized and compressed once,
//! at boot, off the actor threads: brotli at quality 9 within a few hundred
//! milliseconds, then quality 11 at background priority (seconds), kept in a
//! cache file named by the digest so a restart with the same registry
//! skips it.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock, RwLock,
};
use std::time::{Duration, Instant};

use actix_web::{http::header, web, HttpRequest, HttpResponse};
use bytes::Bytes;
use log::{info, warn};

use crate::{InitRegistry, Registry, SharedInitRegistry, VoxelizeHandle};

/// The current registry: revalidated with its digest on every use.
pub const REGISTRY_BLOCKS_PATH: &str = "/registry/blocks.json";
/// One registry by digest: immutable, cacheable forever.
pub const REGISTRY_BLOCKS_BY_DIGEST_PATH: &str = "/registry/blocks.{digest}.json";
/// Response header naming the registry's digest (what JOIN's
/// `registryDigest` should carry).
pub const REGISTRY_DIGEST_HEADER: &str = "x-registry-digest";

/// Brotli at boot: about a quarter of a second on a large registry.
const BOOT_BROTLI_QUALITY: u32 = 9;
/// Brotli's best, seconds of CPU, run once at background priority.
const BEST_BROTLI_QUALITY: u32 = 11;
/// Window big enough to reach back across the whole repetitive block list.
const BROTLI_WINDOW_BITS: u32 = 24;
const GZIP_LEVEL: u32 = 9;
/// How long a request at boot waits for the text, then for a compressed body
/// it accepts, before answering with what there is.
const BOOT_WAIT: Duration = Duration::from_secs(3);
/// Cache files kept, newest first; older registries' files are removed.
const CACHE_FILES_KEPT: usize = 8;
/// Directory override for the quality-11 cache; `off` (or `0`) disables it.
const CACHE_DIR_ENV: &str = "VOXELIZE_REGISTRY_CACHE_DIR";

/// The registry text and its compressed bodies, shared by every HTTP worker.
#[derive(Clone)]
pub struct RegistryEndpoint(Arc<Bodies>);

struct Bodies {
    shared: SharedInitRegistry,
    identity: OnceLock<Bytes>,
    gzip: OnceLock<Bytes>,
    /// Quality 9 first, replaced by quality 11 when that finishes.
    brotli: RwLock<Option<Bytes>>,
    /// Set when the boot encodings are done (or gave up): requests stop
    /// waiting for them.
    is_settled: AtomicBool,
}

/// The shared registry text as an owner `Bytes` can borrow from, so the
/// identity body is the very text INIT carries, never a copy of it.
struct RegistryText(SharedInitRegistry);

impl AsRef<[u8]> for RegistryText {
    fn as_ref(&self) -> &[u8] {
        self.0
            .get()
            .map_or(&[][..], |registry| registry.blocks.get().as_bytes())
    }
}

impl RegistryEndpoint {
    /// Serve `shared`, the server's one copy of the INIT registry text.
    pub fn new(shared: SharedInitRegistry) -> Self {
        Self(Arc::new(Bodies {
            shared,
            identity: OnceLock::new(),
            gzip: OnceLock::new(),
            brotli: RwLock::new(None),
            is_settled: AtomicBool::new(false),
        }))
    }

    /// Serialize the registry (if no world has yet) and compress it on a
    /// thread of its own: the boot bodies first, then brotli's best at
    /// background priority.
    pub fn prepare_in_background(&self, registry: Registry) {
        let endpoint = self.clone();
        let spawned = std::thread::Builder::new()
            .name("registry-encode".to_owned())
            .spawn(move || {
                let cache = cache_dir();
                if endpoint.prepare(&registry, cache.as_deref()) {
                    drop(registry);
                    lower_current_thread_priority();
                    endpoint.encode_best(cache.as_deref());
                }
            });
        if let Err(error) = spawned {
            warn!("[registry] could not start the encoder thread: {error}");
            self.0.is_settled.store(true, Ordering::Relaxed);
        }
    }

    /// The text and the boot bodies. A cached quality-11 body for this
    /// digest is used when it decodes to exactly this text. Returns whether
    /// the best brotli body is still to be made.
    fn prepare(&self, registry: &Registry, cache: Option<&Path>) -> bool {
        let text = self.0.shared.get_or_init("server", registry);
        let raw = text.blocks.get().as_bytes();
        let _ = self
            .0
            .identity
            .set(Bytes::from_owner(RegistryText(self.0.shared.clone())));

        let started = Instant::now();
        let cached = cache.and_then(|dir| read_cached_brotli(dir, text));
        let is_best_pending = cached.is_none();
        let (brotli, brotli_quality) = match cached {
            Some(body) => (Some(body), BEST_BROTLI_QUALITY),
            None => (brotli_encode(raw, BOOT_BROTLI_QUALITY), BOOT_BROTLI_QUALITY),
        };
        let brotli_ms = started.elapsed().as_secs_f64() * 1000.0;
        let brotli_len = brotli.as_ref().map_or(0, Bytes::len);
        if let Some(body) = brotli {
            *self.0.brotli.write().unwrap_or_else(|p| p.into_inner()) = Some(body);
        }

        let started = Instant::now();
        let gzip = gzip_encode(raw);
        let gzip_ms = started.elapsed().as_secs_f64() * 1000.0;
        let gzip_len = gzip.as_ref().map_or(0, Bytes::len);
        if let Some(body) = gzip {
            let _ = self.0.gzip.set(body);
        }
        self.0.is_settled.store(true, Ordering::Relaxed);

        info!(
            "[registry] {} ready, digest {}: identity {} bytes, brotli q{} {} bytes ({:.0} ms{}), \
             gzip-{} {} bytes ({:.0} ms)",
            REGISTRY_BLOCKS_PATH,
            text.digest,
            raw.len(),
            brotli_quality,
            brotli_len,
            brotli_ms,
            if is_best_pending {
                ""
            } else {
                ", from the cache"
            },
            GZIP_LEVEL,
            gzip_len,
            gzip_ms,
        );
        is_best_pending && brotli_len > 0
    }

    /// Replace the boot brotli body with brotli's best, and keep it on disk.
    fn encode_best(&self, cache: Option<&Path>) {
        let Some(text) = self.0.shared.get() else {
            return;
        };
        let started = Instant::now();
        let Some(body) = brotli_encode(text.blocks.get().as_bytes(), BEST_BROTLI_QUALITY) else {
            return;
        };
        let elapsed = started.elapsed();
        let len = body.len();
        let stored = cache.and_then(|dir| write_cached_brotli(dir, text, &body));
        *self.0.brotli.write().unwrap_or_else(|p| p.into_inner()) = Some(body);
        info!(
            "[registry] brotli q{} upgrade finished: {} bytes in {:.1} s{}",
            BEST_BROTLI_QUALITY,
            len,
            elapsed.as_secs_f64(),
            stored.map_or_else(String::new, |path| format!(
                ", cached at {}",
                path.display()
            )),
        );
    }

    fn text(&self) -> Option<&InitRegistry> {
        self.0.shared.get()
    }

    fn brotli(&self) -> Option<Bytes> {
        self.0
            .brotli
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    fn is_settled(&self) -> bool {
        self.0.is_settled.load(Ordering::Relaxed)
    }

    /// Answer a registry request; `pinned` is the digest a by-digest path
    /// names.
    async fn respond(&self, req: &HttpRequest, pinned: Option<&str>) -> HttpResponse {
        let deadline = Instant::now() + BOOT_WAIT;
        while self.text().is_none() && Instant::now() < deadline {
            actix_web::rt::time::sleep(Duration::from_millis(10)).await;
        }
        let Some(text) = self.text() else {
            return HttpResponse::ServiceUnavailable()
                .insert_header((header::RETRY_AFTER, "1"))
                .insert_header((header::CACHE_CONTROL, "no-store"))
                .body("the block registry is still being prepared");
        };
        let digest = text.digest.as_str();

        if pinned.is_some_and(|asked| asked != digest) {
            return HttpResponse::NotFound()
                .insert_header((header::CACHE_CONTROL, "no-store"))
                .insert_header((REGISTRY_DIGEST_HEADER, digest))
                .body(format!("this server's block registry is {digest}"));
        }

        let cache_control = if pinned.is_some() {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        };
        let etag = format!("W/\"{digest}\"");
        let headers = |response: &mut actix_web::HttpResponseBuilder| {
            response
                .insert_header((header::ETAG, etag.as_str()))
                .insert_header((header::CACHE_CONTROL, cache_control))
                .insert_header((header::VARY, "Accept-Encoding"))
                .insert_header((REGISTRY_DIGEST_HEADER, digest));
        };

        if if_none_match_hits(req, digest) {
            let mut response = HttpResponse::NotModified();
            headers(&mut response);
            return response.finish();
        }

        let accepts = |coding: &str| {
            req.headers()
                .get(header::ACCEPT_ENCODING)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| accepts_coding(value, coding))
        };
        let (takes_br, takes_gzip) = (accepts("br"), accepts("gzip"));
        while !self.is_settled()
            && !(takes_br && self.brotli().is_some())
            && (takes_br || takes_gzip)
            && Instant::now() < deadline
        {
            actix_web::rt::time::sleep(Duration::from_millis(10)).await;
        }

        let (coding, body) = match (
            takes_br.then(|| self.brotli()).flatten(),
            takes_gzip.then(|| self.0.gzip.get().cloned()).flatten(),
        ) {
            (Some(body), _) => (Some("br"), body),
            (None, Some(body)) => (Some("gzip"), body),
            (None, None) => (
                None,
                self.0
                    .identity
                    .get()
                    .cloned()
                    .unwrap_or_else(|| Bytes::from_owner(RegistryText(self.0.shared.clone()))),
            ),
        };

        let mut response = HttpResponse::Ok();
        headers(&mut response);
        response.insert_header((header::CONTENT_TYPE, "application/json"));
        if let Some(coding) = coding {
            response.insert_header((header::CONTENT_ENCODING, coding));
        }
        response.body(body)
    }
}

/// `GET /registry/blocks.json`.
pub async fn registry_blocks_route(
    req: HttpRequest,
    handle: web::Data<VoxelizeHandle>,
) -> HttpResponse {
    match handle.registry() {
        Some(endpoint) => endpoint.respond(&req, None).await,
        None => HttpResponse::NotFound().body("this server does not serve its block registry"),
    }
}

/// `GET /registry/blocks.<digest>.json`.
pub async fn registry_blocks_by_digest_route(
    req: HttpRequest,
    digest: web::Path<String>,
    handle: web::Data<VoxelizeHandle>,
) -> HttpResponse {
    match handle.registry() {
        Some(endpoint) => endpoint.respond(&req, Some(digest.as_str())).await,
        None => HttpResponse::NotFound().body("this server does not serve its block registry"),
    }
}

/// Whether an `Accept-Encoding` value takes `coding`: listed (or covered by
/// `*`) with a non-zero quality. An explicit entry wins over `*`.
fn accepts_coding(accept_encoding: &str, coding: &str) -> bool {
    let mut wildcard = None;
    for entry in accept_encoding.split(',') {
        let mut parts = entry.split(';');
        let name = parts.next().unwrap_or("").trim();
        let quality = parts
            .find_map(|part| part.trim().strip_prefix("q="))
            .and_then(|q| q.trim().parse::<f32>().ok())
            .unwrap_or(1.0);
        if name.eq_ignore_ascii_case(coding) {
            return quality > 0.0;
        }
        if name == "*" {
            wildcard = Some(quality > 0.0);
        }
    }
    wildcard.unwrap_or(false)
}

/// Whether `If-None-Match` names this digest (weak comparison) or is `*`.
fn if_none_match_hits(req: &HttpRequest, digest: &str) -> bool {
    req.headers()
        .get_all(header::IF_NONE_MATCH)
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .any(|tag| {
            tag == "*"
                || tag
                    .strip_prefix("W/")
                    .unwrap_or(tag)
                    .strip_prefix('"')
                    .and_then(|tag| tag.strip_suffix('"'))
                    == Some(digest)
        })
}

fn brotli_encode(raw: &[u8], quality: u32) -> Option<Bytes> {
    let mut params = brotli::enc::BrotliEncoderParams::default();
    params.quality = quality as i32;
    params.lgwin = BROTLI_WINDOW_BITS as i32;
    params.size_hint = raw.len();
    let mut out = Vec::with_capacity(raw.len() / 32);
    match brotli::BrotliCompress(&mut &raw[..], &mut out, &params) {
        Ok(_) => Some(Bytes::from(out)),
        Err(error) => {
            warn!("[registry] brotli q{quality} failed: {error}");
            None
        }
    }
}

fn gzip_encode(raw: &[u8]) -> Option<Bytes> {
    let mut encoder = flate2::write::GzEncoder::new(
        Vec::with_capacity(raw.len() / 16),
        flate2::Compression::new(GZIP_LEVEL),
    );
    match encoder.write_all(raw).and_then(|()| encoder.finish()) {
        Ok(out) => Some(Bytes::from(out)),
        Err(error) => {
            warn!("[registry] gzip failed: {error}");
            None
        }
    }
}

fn brotli_decode(body: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    brotli::Decompressor::new(body, 64 * 1024)
        .read_to_end(&mut out)
        .ok()?;
    Some(out)
}

/// Where the quality-11 body is kept between restarts, unless disabled.
fn cache_dir() -> Option<PathBuf> {
    match std::env::var(CACHE_DIR_ENV) {
        Ok(value) if matches!(value.trim(), "" | "0" | "off" | "false") => None,
        Ok(value) => Some(PathBuf::from(value)),
        Err(_) => Some(std::env::temp_dir().join("voxelize-registry")),
    }
}

fn cache_path(dir: &Path, digest: &str) -> PathBuf {
    dir.join(format!("blocks.{digest}.json.br"))
}

/// The cached quality-11 body for `text`, only if it decodes to exactly it.
fn read_cached_brotli(dir: &Path, text: &InitRegistry) -> Option<Bytes> {
    let path = cache_path(dir, &text.digest);
    let body = fs::read(&path).ok()?;
    if brotli_decode(&body).as_deref() == Some(text.blocks.get().as_bytes()) {
        Some(Bytes::from(body))
    } else {
        warn!(
            "[registry] ignoring {}: it does not decode to this registry",
            path.display()
        );
        let _ = fs::remove_file(&path);
        None
    }
}

/// Keep `body` for the next boot with this registry, written whole or not
/// at all, and drop the oldest files past [`CACHE_FILES_KEPT`].
fn write_cached_brotli(dir: &Path, text: &InitRegistry, body: &[u8]) -> Option<PathBuf> {
    let path = cache_path(dir, &text.digest);
    let partial = path.with_extension(format!("br.{}.partial", std::process::id()));
    let written = fs::create_dir_all(dir)
        .and_then(|()| fs::write(&partial, body))
        .and_then(|()| fs::rename(&partial, &path));
    if let Err(error) = written {
        warn!(
            "[registry] could not keep the q11 body at {}: {error}",
            path.display()
        );
        let _ = fs::remove_file(&partial);
        return None;
    }

    let mut kept: Vec<(std::time::SystemTime, PathBuf)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with("blocks.") && name.ends_with(".json.br")
        })
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    kept.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, stale) in kept.into_iter().skip(CACHE_FILES_KEPT) {
        let _ = fs::remove_file(stale);
    }
    Some(path)
}

/// Move the calling thread (only) to the lowest scheduling priority.
fn lower_current_thread_priority() {
    #[cfg(target_os = "macos")]
    // SAFETY: plain FFI call that only affects the calling thread.
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_BACKGROUND, 0);
    }
    #[cfg(target_os = "linux")]
    // SAFETY: plain FFI calls that only affect the calling thread (on Linux,
    // PRIO_PROCESS with a thread id sets that one thread's nice).
    unsafe {
        let tid = libc::syscall(libc::SYS_gettid) as libc::id_t;
        libc::setpriority(libc::PRIO_PROCESS, tid, 19);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        decode_message, Block, GetWorldStats, Message, MessageType, Server, SessionIdentity, World,
        WorldConfig, WsSender,
    };
    use actix_web::{test as http_test, App};
    use serde_json::{json, Value};
    use tokio::sync::mpsc;

    const WORLD: &str = "registryworld";

    fn registry() -> Registry {
        let mut registry = Registry::new();
        let mut blocks = vec![];
        // Enough blocks that the text clears the INIT compression threshold
        // and brotli has something to chew on.
        for id in 1..200u32 {
            blocks.push(
                Block::new(&format!("Block {id}"))
                    .id(id)
                    .is_transparent(id % 3 == 0)
                    .build(),
            );
        }
        registry.register_blocks(&blocks);
        registry
    }

    /// A server with one world, its INIT registry text prepared the way
    /// `bind_with` prepares it (minus the thread), and a handle serving it.
    fn serving() -> (Server, RegistryEndpoint, VoxelizeHandle) {
        let mut server = Server::new().debug(false).registry(&registry()).build();
        server
            .add_world(World::new(WORLD, &WorldConfig::new().build()))
            .expect("world should register");
        let endpoint = RegistryEndpoint::new(server.shared_init_registry());
        assert!(endpoint.prepare(&server.registry, None));
        let handle = VoxelizeHandle::new(actix::Actor::start(Server::new().debug(false).build()))
            .with_registry(endpoint.clone());
        (server, endpoint, handle)
    }

    /// The INIT text a fresh session gets when it joins without a digest.
    async fn init_text(server: &mut Server) -> String {
        let (control_tx, mut control_rx) = mpsc::unbounded_channel();
        let (bulk_tx, _bulk_rx) = mpsc::unbounded_channel();
        let sender = WsSender::new(control_tx, bulk_tx);
        let (id, token) =
            server.register_session(SessionIdentity::for_client("reader"), false, sender.clone());
        let join = Message::new(&MessageType::Join)
            .json(&json!({ "world": WORLD, "username": "reader" }).to_string())
            .build();
        assert_eq!(server.on_request(&id, join, None, 0, Some(&token)), None);
        server
            .get_world(WORLD)
            .unwrap()
            .send(GetWorldStats)
            .await
            .unwrap();
        while let Ok(bytes) = control_rx.try_recv() {
            sender.mark_control_written();
            let message = decode_message(&bytes).ok().or_else(|| {
                let mut decoded = Vec::new();
                lz4_flex::frame::FrameDecoder::new(&bytes[..])
                    .read_to_end(&mut decoded)
                    .ok()?;
                decode_message(&decoded).ok()
            });
            if let Some(message) = message.filter(|m| m.r#type == MessageType::Init as i32) {
                return message.json;
            }
        }
        panic!("no INIT");
    }

    /// The registry text a client cuts out of a full INIT, and its digest.
    fn cut_registry(init: &str) -> (String, String) {
        let json: Value = serde_json::from_str(init).unwrap();
        let length = json["registryBlocksLength"].as_u64().unwrap() as usize;
        let prefix = "{\"blocks\":".len();
        (
            init[prefix..prefix + length].to_owned(),
            json["registryDigest"].as_str().unwrap().to_owned(),
        )
    }

    async fn get(
        handle: &VoxelizeHandle,
        uri: &str,
        headers: &[(&str, &str)],
    ) -> (u16, actix_web::http::header::HeaderMap, Vec<u8>) {
        let app = http_test::init_service(App::new().configure(handle.configure())).await;
        let mut request = http_test::TestRequest::get().uri(uri);
        for (name, value) in headers {
            request = request.insert_header((*name, *value));
        }
        let response = http_test::call_service(&app, request.to_request()).await;
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let body = http_test::read_body(response).await.to_vec();
        (status, headers, body)
    }

    fn header<'a>(headers: &'a actix_web::http::header::HeaderMap, name: &str) -> &'a str {
        headers
            .get(name)
            .unwrap_or_else(|| panic!("missing {name}"))
            .to_str()
            .unwrap()
    }

    #[actix_web::test]
    async fn every_encoding_decodes_to_the_init_registry_text_under_the_init_digest() {
        let (mut server, _endpoint, handle) = serving();
        let (text, digest) = cut_registry(&init_text(&mut server).await);

        let (status, headers, body) = get(
            &handle,
            REGISTRY_BLOCKS_PATH,
            &[("accept-encoding", "gzip, deflate, br, zstd")],
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(header(&headers, "content-encoding"), "br");
        assert_eq!(header(&headers, REGISTRY_DIGEST_HEADER), digest);
        assert_eq!(header(&headers, "etag"), format!("W/\"{digest}\""));
        assert_eq!(header(&headers, "cache-control"), "no-cache");
        assert_eq!(header(&headers, "vary"), "Accept-Encoding");
        assert_eq!(header(&headers, "content-type"), "application/json");
        assert!(body.len() < text.len());
        assert_eq!(
            brotli_decode(&body).unwrap(),
            text.as_bytes(),
            "byte-identical"
        );

        let (_, headers, body) = get(
            &handle,
            REGISTRY_BLOCKS_PATH,
            &[("accept-encoding", "gzip, deflate")],
        )
        .await;
        assert_eq!(header(&headers, "content-encoding"), "gzip");
        let mut decoded = Vec::new();
        flate2::read::GzDecoder::new(&body[..])
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, text.as_bytes());

        let (_, headers, body) = get(&handle, REGISTRY_BLOCKS_PATH, &[]).await;
        assert!(headers.get("content-encoding").is_none());
        assert_eq!(body, text.as_bytes());
        assert_eq!(crate::registry_digest(&body), digest);
    }

    #[actix_web::test]
    async fn a_matching_etag_is_a_304_and_the_digest_path_is_immutable() {
        let (mut server, _endpoint, handle) = serving();
        let (_, digest) = cut_registry(&init_text(&mut server).await);

        for tag in [
            format!("W/\"{digest}\""),
            format!("\"{digest}\""),
            "*".to_owned(),
        ] {
            let (status, headers, body) = get(
                &handle,
                REGISTRY_BLOCKS_PATH,
                &[("if-none-match", tag.as_str())],
            )
            .await;
            assert_eq!(status, 304, "{tag}");
            assert!(body.is_empty());
            assert_eq!(header(&headers, REGISTRY_DIGEST_HEADER), digest);
        }
        let (status, _, _) = get(
            &handle,
            REGISTRY_BLOCKS_PATH,
            &[("if-none-match", "W/\"stale-1\"")],
        )
        .await;
        assert_eq!(status, 200);

        let pinned = format!("/registry/blocks.{digest}.json");
        let (status, headers, body) = get(&handle, &pinned, &[("accept-encoding", "br")]).await;
        assert_eq!(status, 200);
        assert_eq!(
            header(&headers, "cache-control"),
            "public, max-age=31536000, immutable"
        );
        assert!(!body.is_empty());

        let (status, headers, _) = get(
            &handle,
            "/registry/blocks.0123abcd-99.json",
            &[("accept-encoding", "br")],
        )
        .await;
        assert_eq!(status, 404);
        assert_eq!(header(&headers, "cache-control"), "no-store");
        assert_eq!(header(&headers, REGISTRY_DIGEST_HEADER), digest);
    }

    #[actix_web::test]
    async fn the_best_brotli_replaces_the_boot_body_and_is_kept_by_digest() {
        let (server, endpoint, handle) = serving();
        let text = endpoint.text().unwrap().blocks.get().to_owned();
        let digest = endpoint.text().unwrap().digest.clone();
        let dir = std::env::temp_dir().join(format!(
            "voxelize-registry-test-{}-{}",
            std::process::id(),
            fastrand::u64(..)
        ));
        endpoint.encode_best(Some(&dir));
        assert!(cache_path(&dir, &digest).exists());

        let (_, _, body) = get(&handle, REGISTRY_BLOCKS_PATH, &[("accept-encoding", "br")]).await;
        assert_eq!(brotli_decode(&body).unwrap(), text.as_bytes());

        // A restart with the same registry takes the kept body (and needs no
        // second pass); a corrupt one is refused and removed.
        let restarted = RegistryEndpoint::new(SharedInitRegistry::default());
        assert!(!restarted.prepare(&server.registry, Some(&dir)));
        assert_eq!(
            restarted.brotli().unwrap(),
            Bytes::from(fs::read(cache_path(&dir, &digest)).unwrap())
        );
        fs::write(cache_path(&dir, &digest), b"not brotli").unwrap();
        let corrupt = RegistryEndpoint::new(SharedInitRegistry::default());
        assert!(corrupt.prepare(&server.registry, Some(&dir)));
        assert!(!cache_path(&dir, &digest).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[actix_web::test]
    async fn a_handle_without_a_registry_says_so() {
        let handle = VoxelizeHandle::new(actix::Actor::start(Server::new().debug(false).build()));
        let (status, _, _) = get(&handle, REGISTRY_BLOCKS_PATH, &[]).await;
        assert_eq!(status, 404);
    }

    #[test]
    fn accept_encoding_honours_quality_and_wildcards() {
        assert!(accepts_coding("gzip, deflate, br, zstd", "br"));
        assert!(accepts_coding("BR;q=0.5", "br"));
        assert!(!accepts_coding("br;q=0, gzip", "br"));
        assert!(!accepts_coding("br;q=0, *", "br"));
        assert!(accepts_coding("*", "gzip"));
        assert!(!accepts_coding("identity", "gzip"));
        assert!(!accepts_coding("", "br"));
    }
}
