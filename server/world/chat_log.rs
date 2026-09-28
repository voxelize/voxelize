//! The world's chat history: every public line it keeps, in order, so a
//! client that joins (or reloads) sees what was said before it arrived.
//!
//! [`ChatLog`] is an ECS resource. It holds the last
//! [`WorldConfig::chat_history_capacity`] lines in memory, which serves the
//! join replay and every page a client asks for without touching disk. When
//! the world names a directory for it (its `save_dir`, or
//! [`WorldConfig::chat_log_dir`]), each line is also appended to
//! `<dir>/chat.jsonl` by a background writer thread, so the history outlives
//! a restart and the tick never waits on the filesystem. The file is capped:
//! once it holds twice the capacity, the writer rewrites it down to the last
//! `capacity` lines (write to a temp file, then rename over).
//!
//! Only lines that were broadcast to everyone belong here: player chat
//! ([`World::on_chat`](super::World)) and whatever a game posts through
//! [`World::post_chat`](super::World::post_chat). Commands, direct replies
//! and diagnostics are never logged.

use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread::{self, JoinHandle};
use std::time::{SystemTime, UNIX_EPOCH};

use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use log::{error, warn};
use serde::{Deserialize, Serialize};
use specs::shred::Fetch;

use super::{World, WorldConfig};
use crate::{common::ClientFilter, ChatMessageProtocol, Message, MessageType, MethodProtocol};

/// A line a player typed.
pub const CHAT_KIND_PLAYER: &str = "player";

/// A line the server (or a transport speaking for it) announced.
pub const CHAT_KIND_SYSTEM: &str = "system";

/// Lines a joining client receives with its INIT.
pub const CHAT_HISTORY_JOIN_LIMIT: usize = 100;

/// Most lines one history page answers with, whatever a client asks for.
pub const CHAT_HISTORY_PAGE_LIMIT: usize = 100;

/// Method a client calls for an older page, and the name of the reply.
pub const CHAT_HISTORY_METHOD: &str = "vox-builtin:chat-history";

/// INIT key carrying the join replay.
pub const CHAT_HISTORY_INIT_KEY: &str = "chatHistory";

/// File name inside the chat log directory.
pub const CHAT_LOG_FILE: &str = "chat.jsonl";

/// Longest body kept, in characters; longer lines are cut in the log only.
pub const CHAT_LOG_MAX_BODY_CHARS: usize = 1000;

/// Longest sender markup kept, in characters.
pub const CHAT_LOG_MAX_SENDER_CHARS: usize = 200;

/// Metadata longer than this (bytes) is dropped from the log entry: cutting
/// JSON in half would leave it unparseable.
pub const CHAT_LOG_MAX_METADATA_BYTES: usize = 1024;

/// Lines the writer may have queued before new ones skip the disk (they
/// still reach memory and every client).
const WRITER_QUEUE_CAPACITY: usize = 4096;

/// One line of the world's chat history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatLogEntry {
    /// Position in the log, from 1, strictly increasing across restarts.
    pub seq: u64,
    /// Unix milliseconds the server logged it at.
    pub sent_at: u64,
    /// Who spoke, as the server knows it: [`CHAT_KIND_PLAYER`],
    /// [`CHAT_KIND_SYSTEM`], or a kind the game defines.
    pub kind: String,
    /// The speaker's client id; empty for the server.
    #[serde(default)]
    pub sender_id: String,
    /// The speaker's username as the server knows it; empty for the server.
    #[serde(default)]
    pub sender_name: String,
    /// The chat protocol `type` the line was broadcast with.
    #[serde(default, rename = "type")]
    pub chat_type: String,
    /// The sender label exactly as it was broadcast.
    #[serde(default)]
    pub sender: String,
    pub body: String,
    #[serde(default)]
    pub metadata: String,
}

/// A line about to be logged; the log stamps its `seq` and `sent_at`.
#[derive(Debug, Clone, Copy)]
pub struct NewChatLine<'a> {
    pub kind: &'a str,
    pub sender_id: &'a str,
    pub sender_name: &'a str,
    pub chat_type: &'a str,
    pub sender: &'a str,
    pub body: &'a str,
    pub metadata: &'a str,
}

/// One page of history, oldest first.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryPage {
    pub entries: Vec<ChatLogEntry>,
    /// Whether the log holds lines older than the first entry.
    pub has_more: bool,
}

/// A client's request for the page before `before`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryRequest {
    pub before: Option<u64>,
    pub limit: Option<usize>,
}

/// The reply to a [`ChatHistoryRequest`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryReply {
    pub before: Option<u64>,
    #[serde(flatten)]
    pub page: ChatHistoryPage,
}

enum WriterMessage {
    Append(ChatLogEntry),
    Flush(Sender<()>),
}

struct ChatLogWriter {
    sender: Option<Sender<WriterMessage>>,
    handle: Option<JoinHandle<()>>,
    dropped: u64,
}

/// The world's chat history (see the module docs).
pub struct ChatLog {
    entries: VecDeque<ChatLogEntry>,
    capacity: usize,
    next_seq: u64,
    path: Option<PathBuf>,
    /// Started on the first line recorded: a world nobody chats in never
    /// creates the directory or the thread.
    writer: Option<ChatLogWriter>,
    /// What the file looked like when it was read, for the writer's start.
    lines_on_disk: usize,
    needs_rewrite: bool,
}

impl ChatLog {
    /// The log `config` asks for: no history when its capacity is zero,
    /// otherwise a memory window persisted to [`Self::dir_for`] when that
    /// names a directory.
    pub fn from_config(config: &WorldConfig) -> Self {
        Self::open(Self::dir_for(config), config.chat_history_capacity)
    }

    /// Where `config` keeps its chat log: [`WorldConfig::chat_log_dir`] when
    /// set, else `<save_dir>/chat` on a saved world, else nowhere.
    pub fn dir_for(config: &WorldConfig) -> Option<PathBuf> {
        if config.chat_history_capacity == 0 {
            return None;
        }
        if let Some(dir) = &config.chat_log_dir {
            return Some(PathBuf::from(dir));
        }
        if config.saving && !config.save_dir.is_empty() {
            return Some(PathBuf::from(&config.save_dir).join("chat"));
        }
        None
    }

    /// A log keeping the last `capacity` lines, read back from and appended
    /// to `<dir>/chat.jsonl` when `dir` is given.
    pub fn open(dir: Option<PathBuf>, capacity: usize) -> Self {
        let mut log = Self {
            entries: VecDeque::new(),
            capacity,
            next_seq: 1,
            path: None,
            writer: None,
            lines_on_disk: 0,
            needs_rewrite: false,
        };
        if capacity == 0 {
            return log;
        }
        let Some(dir) = dir else {
            return log;
        };
        let path = dir.join(CHAT_LOG_FILE);
        let loaded = read_log_file(&path, capacity);
        if let Some(last) = loaded.entries.back() {
            log.next_seq = last.seq + 1;
        }
        log.entries = loaded.entries;
        log.lines_on_disk = loaded.lines_on_disk;
        log.needs_rewrite = loaded.needs_rewrite;
        log.path = Some(path);
        log
    }

    /// Whether this log keeps anything at all.
    pub fn is_enabled(&self) -> bool {
        self.capacity > 0
    }

    /// The file this log persists to, if any.
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Lines held in memory.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Appends `line`, stamped with the next `seq` and the current time, and
    /// queues it for the disk. `None` when the log keeps nothing.
    pub fn record(&mut self, line: NewChatLine<'_>) -> Option<ChatLogEntry> {
        self.record_at(line, unix_ms())
    }

    /// [`Self::record`] at an explicit time (tests).
    pub fn record_at(&mut self, line: NewChatLine<'_>, sent_at: u64) -> Option<ChatLogEntry> {
        if !self.is_enabled() {
            return None;
        }
        let entry = ChatLogEntry {
            seq: self.next_seq,
            sent_at,
            kind: line.kind.to_owned(),
            sender_id: line.sender_id.to_owned(),
            sender_name: line.sender_name.to_owned(),
            chat_type: line.chat_type.to_owned(),
            sender: truncate_chars(line.sender, CHAT_LOG_MAX_SENDER_CHARS),
            body: truncate_chars(line.body, CHAT_LOG_MAX_BODY_CHARS),
            metadata: if line.metadata.len() > CHAT_LOG_MAX_METADATA_BYTES {
                String::new()
            } else {
                line.metadata.to_owned()
            },
        };
        self.next_seq += 1;
        if self.writer.is_none() {
            if let Some(path) = self.path.clone() {
                self.writer = Some(ChatLogWriter::spawn(
                    path,
                    self.capacity,
                    self.entries.clone(),
                    self.lines_on_disk,
                    self.needs_rewrite,
                ));
            }
        }
        self.entries.push_back(entry.clone());
        while self.entries.len() > self.capacity {
            self.entries.pop_front();
        }
        if let Some(writer) = self.writer.as_mut() {
            writer.append(entry.clone());
        }
        Some(entry)
    }

    /// The newest `limit` lines (clamped to the page limit), oldest first.
    pub fn recent(&self, limit: usize) -> ChatHistoryPage {
        self.before(None, limit)
    }

    /// Up to `limit` lines (clamped to [`CHAT_HISTORY_PAGE_LIMIT`]) older
    /// than `before` (all lines when `None`), oldest first.
    pub fn before(&self, before: Option<u64>, limit: usize) -> ChatHistoryPage {
        let limit = limit.clamp(1, CHAT_HISTORY_PAGE_LIMIT);
        let end = match before {
            Some(seq) => self.entries.partition_point(|entry| entry.seq < seq),
            None => self.entries.len(),
        };
        let start = end.saturating_sub(limit);
        ChatHistoryPage {
            entries: self.entries.range(start..end).cloned().collect(),
            has_more: start > 0,
        }
    }

    /// Blocks until every line recorded so far is on disk (tests, shutdown).
    pub fn flush(&self) {
        if let Some(writer) = self.writer.as_ref() {
            writer.flush();
        }
    }
}

impl Drop for ChatLog {
    fn drop(&mut self) {
        if let Some(mut writer) = self.writer.take() {
            writer.close();
        }
    }
}

impl ChatLogWriter {
    fn spawn(
        path: PathBuf,
        capacity: usize,
        tail: VecDeque<ChatLogEntry>,
        lines_on_disk: usize,
        needs_rewrite: bool,
    ) -> Self {
        let (sender, receiver) = bounded::<WriterMessage>(WRITER_QUEUE_CAPACITY);
        let handle = thread::Builder::new()
            .name("chat-log-writer".to_owned())
            .spawn(move || {
                writer_loop(receiver, path, capacity, tail, lines_on_disk, needs_rewrite);
            })
            .map_err(|error| error!("Chat log writer thread failed to start: {}", error))
            .ok();
        Self {
            sender: handle.as_ref().map(|_| sender),
            handle,
            dropped: 0,
        }
    }

    fn append(&mut self, entry: ChatLogEntry) {
        let Some(sender) = self.sender.as_ref() else {
            return;
        };
        match sender.try_send(WriterMessage::Append(entry)) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.dropped += 1;
                if self.dropped == 1 || self.dropped % 100 == 0 {
                    warn!(
                        "Chat log writer is behind; {} line(s) kept in memory only.",
                        self.dropped
                    );
                }
            }
            Err(TrySendError::Disconnected(_)) => {
                self.sender = None;
            }
        }
    }

    fn flush(&self) {
        let Some(sender) = self.sender.as_ref() else {
            return;
        };
        let (ack, done) = bounded(1);
        if sender.send(WriterMessage::Flush(ack)).is_ok() {
            let _ = done.recv();
        }
    }

    fn close(&mut self) {
        // Dropping the sender lets the writer drain what is queued, write
        // it, and exit.
        self.sender = None;
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn writer_loop(
    receiver: Receiver<WriterMessage>,
    path: PathBuf,
    capacity: usize,
    mut tail: VecDeque<ChatLogEntry>,
    mut lines_on_disk: usize,
    needs_rewrite: bool,
) {
    if needs_rewrite {
        match rewrite(&path, &tail) {
            Ok(()) => lines_on_disk = tail.len(),
            Err(error) => error!("Chat log repair of {} failed: {}", path.display(), error),
        }
    }
    let mut file = open_append(&path);
    let mut buffer = String::new();
    let mut acks: Vec<Sender<()>> = Vec::new();

    while let Ok(first) = receiver.recv() {
        // One write per wake: a burst of lines queued while the last write
        // ran lands together.
        let mut next = Some(first);
        while let Some(message) = next.take().or_else(|| receiver.try_recv().ok()) {
            match message {
                WriterMessage::Append(entry) => match serde_json::to_string(&entry) {
                    Ok(line) => {
                        buffer.push_str(&line);
                        buffer.push('\n');
                        tail.push_back(entry);
                        while tail.len() > capacity {
                            tail.pop_front();
                        }
                        lines_on_disk += 1;
                    }
                    Err(error) => warn!("Chat log line could not be encoded: {}", error),
                },
                WriterMessage::Flush(ack) => acks.push(ack),
            }
        }

        if !buffer.is_empty() {
            if file.is_none() {
                file = open_append(&path);
            }
            if let Some(handle) = file.as_mut() {
                if let Err(error) = handle
                    .write_all(buffer.as_bytes())
                    .and_then(|_| handle.flush())
                {
                    error!("Chat log write to {} failed: {}", path.display(), error);
                    file = None;
                }
            }
            buffer.clear();
        }

        if lines_on_disk >= capacity.saturating_mul(2) {
            match rewrite(&path, &tail) {
                Ok(()) => {
                    lines_on_disk = tail.len();
                    file = open_append(&path);
                }
                Err(error) => error!(
                    "Chat log compaction of {} failed: {}",
                    path.display(),
                    error
                ),
            }
        }

        for ack in acks.drain(..) {
            let _ = ack.send(());
        }
    }
}

fn open_append(path: &Path) -> Option<File> {
    if let Some(dir) = path.parent() {
        if let Err(error) = fs::create_dir_all(dir) {
            error!(
                "Chat log directory {} could not be created: {}",
                dir.display(),
                error
            );
            return None;
        }
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error!("Chat log {} could not be opened: {}", path.display(), error))
        .ok()
}

/// Replaces the file with exactly `entries`, atomically.
fn rewrite(path: &Path, entries: &VecDeque<ChatLogEntry>) -> std::io::Result<()> {
    let mut contents = String::new();
    for entry in entries {
        if let Ok(line) = serde_json::to_string(entry) {
            contents.push_str(&line);
            contents.push('\n');
        }
    }
    let temp = path.with_extension("jsonl.tmp");
    {
        let mut file = File::create(&temp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&temp, path)
}

struct LoadedLog {
    entries: VecDeque<ChatLogEntry>,
    lines_on_disk: usize,
    /// A torn last line (a crash mid-write) or unreadable lines: the writer
    /// rewrites the file clean before appending to it.
    needs_rewrite: bool,
}

fn read_log_file(path: &Path, capacity: usize) -> LoadedLog {
    // Bytes, decoded line by line: a crash can tear the last line inside a
    // multibyte character, and that must cost only that line, not the file.
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => {
            error!(
                "Chat log {} could not be read ({}); starting a new one beside it.",
                path.display(),
                error
            );
            let _ = fs::rename(path, path.with_extension("jsonl.unreadable"));
            Vec::new()
        }
    };
    let mut entries: VecDeque<ChatLogEntry> = VecDeque::new();
    let mut lines_on_disk = 0;
    let mut needs_rewrite = !contents.is_empty() && !contents.ends_with(b"\n");
    let mut last_seq = 0;
    for bytes in contents.split(|byte| *byte == b'\n') {
        let Ok(line) = std::str::from_utf8(bytes) else {
            lines_on_disk += 1;
            needs_rewrite = true;
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }
        lines_on_disk += 1;
        match serde_json::from_str::<ChatLogEntry>(line) {
            // Out-of-order seqs would break paging; keep the first run.
            Ok(entry) if entry.seq > last_seq => {
                last_seq = entry.seq;
                entries.push_back(entry);
                while entries.len() > capacity {
                    entries.pop_front();
                }
            }
            _ => needs_rewrite = true,
        }
    }
    LoadedLog {
        entries,
        lines_on_disk,
        needs_rewrite,
    }
}

impl World {
    /// The world's chat history.
    pub fn chat_log(&self) -> Fetch<'_, ChatLog> {
        self.read_resource::<ChatLog>()
    }

    /// Logs `chat` as a public line of `kind` spoken by `sender_id` /
    /// `sender_name` (empty for the server) and broadcasts it to every
    /// client, stamped with its log position. Returns that position, or
    /// `None` when the world keeps no history (the line is still sent).
    pub fn post_chat(
        &mut self,
        kind: &str,
        sender_id: &str,
        sender_name: &str,
        mut chat: ChatMessageProtocol,
    ) -> Option<u64> {
        chat.seq = 0;
        chat.sent_at = 0.0;
        let entry = self.write_resource::<ChatLog>().record(NewChatLine {
            kind,
            sender_id,
            sender_name,
            chat_type: &chat.r#type,
            sender: &chat.sender,
            body: &chat.body,
            metadata: &chat.metadata,
        });
        if let Some(entry) = &entry {
            chat.seq = entry.seq;
            chat.sent_at = entry.sent_at as f64;
        }
        let message = Message::new(&MessageType::Chat)
            .world_name(&self.name.clone())
            .chat(chat)
            .build();
        self.broadcast(message, ClientFilter::All);
        entry.map(|entry| entry.seq)
    }

    /// Logs a line a client (or a transport) is about to broadcast and
    /// stamps the wire copy with its position. Whatever `seq` / `sent_at`
    /// the sender put on the line is discarded first: those are the server's
    /// to stamp, and a forged one would make every client drop the real line
    /// that later takes that number as a repeat.
    pub(super) fn log_inbound_chat(
        &mut self,
        client_id: &str,
        chat: &mut crate::protocols::ChatMessage,
    ) {
        chat.seq = 0;
        chat.sent_at = 0.0;
        if chat.body.trim().is_empty() {
            return;
        }
        let (kind, sender_id, sender_name) = match self.clients().get(client_id) {
            Some(client) => (
                CHAT_KIND_PLAYER,
                client_id.to_owned(),
                client.username.clone(),
            ),
            None => (CHAT_KIND_SYSTEM, String::new(), String::new()),
        };
        let entry = self.write_resource::<ChatLog>().record(NewChatLine {
            kind,
            sender_id: &sender_id,
            sender_name: &sender_name,
            chat_type: &chat.r#type,
            sender: &chat.sender,
            body: &chat.body,
            metadata: &chat.metadata,
        });
        if let Some(entry) = entry {
            chat.seq = entry.seq;
            chat.sent_at = entry.sent_at as f64;
        }
    }

    /// The join replay carried in a client's INIT, or `None` when the world
    /// keeps no history.
    pub(super) fn chat_history_for_init(&self) -> Option<serde_json::Value> {
        let log = self.chat_log();
        if !log.is_enabled() {
            return None;
        }
        serde_json::to_value(log.recent(CHAT_HISTORY_JOIN_LIMIT)).ok()
    }

    /// Answers a [`CHAT_HISTORY_METHOD`] call with the page before the
    /// requested line, straight to the caller.
    pub(super) fn reply_chat_history(&mut self, client_id: &str, payload: &str) {
        let request: ChatHistoryRequest =
            serde_json::from_str(payload).unwrap_or(ChatHistoryRequest {
                before: None,
                limit: None,
            });
        let reply = ChatHistoryReply {
            before: request.before,
            page: self.chat_log().before(
                request.before,
                request.limit.unwrap_or(CHAT_HISTORY_PAGE_LIMIT),
            ),
        };
        let Ok(payload) = serde_json::to_string(&reply) else {
            return;
        };
        self.broadcast(
            Message::new(&MessageType::Method)
                .method(MethodProtocol {
                    name: CHAT_HISTORY_METHOD.to_owned(),
                    payload,
                })
                .build(),
            ClientFilter::Direct(client_id.to_owned()),
        );
    }
}

fn truncate_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((cut, _)) => text[..cut].to_owned(),
        None => text.to_owned(),
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "voxelize-chat-log-{}-{}-{}",
            label,
            std::process::id(),
            unix_ms()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn say<'a>(body: &'a str) -> NewChatLine<'a> {
        NewChatLine {
            kind: CHAT_KIND_PLAYER,
            sender_id: "client-a",
            sender_name: "alice",
            chat_type: "CLIENT",
            sender: "[alice]",
            body,
            metadata: "{\"speakerId\":\"client-a\"}",
        }
    }

    #[test]
    fn lines_survive_a_restart_in_order() {
        let dir = temp_dir("restart");
        {
            let mut log = ChatLog::open(Some(dir.clone()), 50);
            log.record_at(say("first"), 1_000).unwrap();
            log.record_at(say("second"), 2_000).unwrap();
            log.flush();
        }
        let mut log = ChatLog::open(Some(dir.clone()), 50);
        let page = log.recent(10);
        let bodies: Vec<&str> = page.entries.iter().map(|e| e.body.as_str()).collect();
        assert_eq!(bodies, ["first", "second"]);
        assert_eq!(page.entries[0].seq, 1);
        assert_eq!(page.entries[1].sent_at, 2_000);
        assert_eq!(page.entries[1].sender_name, "alice");
        assert!(!page.has_more);

        let third = log.record_at(say("third"), 3_000).unwrap();
        assert_eq!(third.seq, 3, "seq continues across the restart");
        drop(log);

        let log = ChatLog::open(Some(dir.clone()), 50);
        assert_eq!(log.recent(10).entries.last().unwrap().body, "third");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_file_stays_bounded() {
        let dir = temp_dir("bounded");
        let capacity = 20;
        {
            let mut log = ChatLog::open(Some(dir.clone()), capacity);
            for i in 0..(capacity * 7 + 3) {
                log.record_at(say(&format!("line {i}")), i as u64).unwrap();
            }
            log.flush();
            assert_eq!(log.len(), capacity);
        }
        let contents = fs::read_to_string(dir.join(CHAT_LOG_FILE)).unwrap();
        let lines = contents.lines().count();
        assert!(
            lines >= capacity && lines < capacity * 2,
            "file holds {lines} lines for capacity {capacity}"
        );
        let log = ChatLog::open(Some(dir.clone()), capacity);
        let page = log.recent(CHAT_HISTORY_PAGE_LIMIT);
        assert_eq!(page.entries.len(), capacity);
        assert_eq!(
            page.entries.last().unwrap().body,
            format!("line {}", capacity * 7 + 2)
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn pages_walk_back_without_overlap() {
        let mut log = ChatLog::open(None, 500);
        for i in 0..250 {
            log.record_at(say(&format!("{i}")), i).unwrap();
        }
        let newest = log.recent(CHAT_HISTORY_JOIN_LIMIT);
        assert_eq!(newest.entries.len(), 100);
        assert_eq!(newest.entries[0].seq, 151);
        assert!(newest.has_more);

        let older = log.before(Some(newest.entries[0].seq), 100);
        assert_eq!(older.entries.first().unwrap().seq, 51);
        assert_eq!(older.entries.last().unwrap().seq, 150);
        assert!(older.has_more);

        let oldest = log.before(Some(older.entries[0].seq), 100);
        assert_eq!(oldest.entries.len(), 50);
        assert_eq!(oldest.entries[0].seq, 1);
        assert!(!oldest.has_more);

        assert!(log.before(Some(1), 100).entries.is_empty());
        assert_eq!(
            log.before(None, 10_000).entries.len(),
            CHAT_HISTORY_PAGE_LIMIT,
            "a page is clamped however much a client asks for"
        );
    }

    #[test]
    fn a_torn_last_line_is_repaired() {
        let dir = temp_dir("torn");
        fs::create_dir_all(&dir).unwrap();
        let good = serde_json::to_string(&ChatLogEntry {
            seq: 4,
            sent_at: 10,
            kind: CHAT_KIND_SYSTEM.to_owned(),
            sender_id: String::new(),
            sender_name: String::new(),
            chat_type: "SYSTEM".to_owned(),
            sender: String::new(),
            body: "kept".to_owned(),
            metadata: String::new(),
        })
        .unwrap();
        fs::write(dir.join(CHAT_LOG_FILE), format!("{good}\n{{\"seq\":5,\"bo")).unwrap();
        {
            let mut log = ChatLog::open(Some(dir.clone()), 50);
            assert_eq!(log.len(), 1);
            assert_eq!(log.record_at(say("after"), 20).unwrap().seq, 5);
            log.flush();
        }
        let log = ChatLog::open(Some(dir.clone()), 50);
        let bodies: Vec<String> = log.recent(10).entries.into_iter().map(|e| e.body).collect();
        assert_eq!(bodies, ["kept", "after"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_line_torn_inside_a_multibyte_character_costs_only_that_line() {
        let dir = temp_dir("torn-utf8");
        fs::create_dir_all(&dir).unwrap();
        let line = |seq: u64, body: &str| {
            serde_json::to_string(&ChatLogEntry {
                seq,
                sent_at: seq * 10,
                kind: CHAT_KIND_PLAYER.to_owned(),
                sender_id: "client-a".to_owned(),
                sender_name: "alice".to_owned(),
                chat_type: "CLIENT".to_owned(),
                sender: "[alice]".to_owned(),
                body: body.to_owned(),
                metadata: String::new(),
            })
            .unwrap()
        };
        let torn = line(3, "party 🎉 time");
        let cut = torn.find('🎉').unwrap() + 2;
        let mut bytes = format!("{}\n{}\n", line(1, "café"), line(2, "naïve")).into_bytes();
        bytes.extend_from_slice(&torn.as_bytes()[..cut]);
        assert!(std::str::from_utf8(&bytes).is_err(), "the tear splits a character");
        fs::write(dir.join(CHAT_LOG_FILE), &bytes).unwrap();
        {
            let mut log = ChatLog::open(Some(dir.clone()), 50);
            let bodies: Vec<String> = log.recent(10).entries.into_iter().map(|e| e.body).collect();
            assert_eq!(bodies, ["café", "naïve"]);
            assert_eq!(log.record_at(say("after"), 40).unwrap().seq, 3);
            log.flush();
        }
        assert!(!dir.join("chat.jsonl.unreadable").exists());
        let contents = fs::read_to_string(dir.join(CHAT_LOG_FILE)).unwrap();
        assert_eq!(contents.lines().count(), 3, "rewritten clean: {contents}");
        let log = ChatLog::open(Some(dir.clone()), 50);
        let bodies: Vec<String> = log.recent(10).entries.into_iter().map(|e| e.body).collect();
        assert_eq!(bodies, ["café", "naïve", "after"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn oversized_fields_are_cut_in_the_log_only() {
        let mut log = ChatLog::open(None, 10);
        let body = "é".repeat(CHAT_LOG_MAX_BODY_CHARS + 50);
        let metadata = format!(
            "{{\"pad\":\"{}\"}}",
            "x".repeat(CHAT_LOG_MAX_METADATA_BYTES)
        );
        let entry = log
            .record(NewChatLine {
                metadata: &metadata,
                ..say(&body)
            })
            .unwrap();
        assert_eq!(entry.body.chars().count(), CHAT_LOG_MAX_BODY_CHARS);
        assert!(entry.metadata.is_empty());
    }

    #[test]
    fn nothing_touches_disk_until_someone_speaks() {
        let dir = temp_dir("quiet");
        let mut log = ChatLog::open(Some(dir.clone()), 10);
        assert!(!dir.exists(), "opening a log creates nothing");
        log.record(say("hello")).unwrap();
        log.flush();
        assert!(dir.join(CHAT_LOG_FILE).exists());
        drop(log);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_zero_capacity_log_keeps_nothing() {
        let mut log = ChatLog::open(Some(temp_dir("off")), 0);
        assert!(log.record(say("hi")).is_none());
        assert!(log.path().is_none());
        assert!(log.recent(10).entries.is_empty());
    }

    mod in_a_world {
        use super::*;
        use crate::{
            protocols::ChatMessage, ClientPreferencesPatch, MessageQueues, MotionProtocol,
            Registry, SessionIdentity, WsSender,
        };

        fn world_with(name: &str, config: &WorldConfig) -> World {
            let mut world = World::new(name, config);
            world.ecs_mut().insert(Registry::new());
            world
        }

        fn world_logging_to(dir: &Path, name: &str) -> World {
            let config = WorldConfig::new()
                .chat_log_dir(dir.to_str().unwrap())
                .build();
            world_with(name, &config)
        }

        fn join(world: &mut World, id: &str, username: &str) {
            let (control, _) = tokio::sync::mpsc::unbounded_channel();
            let (bulk, _) = tokio::sync::mpsc::unbounded_channel();
            world.add_client(
                id,
                username,
                &WsSender::new(control, bulk),
                ClientPreferencesPatch::default(),
                MotionProtocol::default(),
                SessionIdentity::anonymous(),
            );
        }

        fn type_line(world: &mut World, from: &str, body: &str) {
            let mut message = Message::new(&MessageType::Chat).build();
            message.chat = Some(ChatMessage {
                r#type: "CLIENT".to_owned(),
                sender: format!("[{from}]"),
                body: body.to_owned(),
                metadata: format!("{{\"speakerId\":\"{from}\"}}"),
                ..Default::default()
            });
            world.on_chat(from, message);
        }

        fn drained(world: &mut World) -> Vec<(Message, ClientFilter)> {
            world.write_resource::<MessageQueues>().drain_prioritized()
        }

        fn broadcast_chats(world: &mut World) -> Vec<ChatMessage> {
            drained(world)
                .into_iter()
                .filter(|(message, filter)| {
                    message.r#type == MessageType::Chat as i32
                        && matches!(filter, ClientFilter::All)
                })
                .filter_map(|(message, _)| message.chat)
                .collect()
        }

        fn init_history(world: &World, id: &str) -> serde_json::Value {
            let (init, _) = world.generate_init_message(id, None, None, None, None, None, false);
            let json: serde_json::Value = serde_json::from_str(&init.json).unwrap();
            json[CHAT_HISTORY_INIT_KEY].clone()
        }

        #[test]
        fn public_lines_are_stamped_logged_and_replayed_to_the_next_joiner() {
            let dir = temp_dir("world-replay");
            let mut world = world_logging_to(&dir, "chat-log-replay");
            join(&mut world, "a", "alice");
            drained(&mut world);

            type_line(&mut world, "a", "hello there");
            type_line(&mut world, "a", "/tp 0 90 0");
            let chats = broadcast_chats(&mut world);
            assert_eq!(chats.len(), 1, "the command is never broadcast");
            assert_eq!(chats[0].seq, 1);
            assert!(chats[0].sent_at > 0.0);

            let history = init_history(&world, "b");
            let entries = history["entries"].as_array().unwrap();
            assert_eq!(entries.len(), 1, "commands stay out of the log: {history}");
            assert_eq!(entries[0]["body"], "hello there");
            assert_eq!(entries[0]["kind"], CHAT_KIND_PLAYER);
            assert_eq!(entries[0]["senderId"], "a");
            assert_eq!(entries[0]["senderName"], "alice");
            assert_eq!(entries[0]["type"], "CLIENT");
            assert_eq!(history["hasMore"], false);

            let (transport_init, _) =
                world.generate_init_message("t", None, None, None, None, None, true);
            let transport_json: serde_json::Value =
                serde_json::from_str(&transport_init.json).unwrap();
            assert!(transport_json.get(CHAT_HISTORY_INIT_KEY).is_none());
            fs::remove_dir_all(&dir).ok();
        }

        #[test]
        fn the_history_outlives_a_restart_of_the_world() {
            let dir = temp_dir("world-restart");
            {
                let mut world = world_logging_to(&dir, "chat-log-restart");
                join(&mut world, "a", "alice");
                join(&mut world, "b", "bob");
                type_line(&mut world, "a", "before the restart");
                type_line(&mut world, "b", "me too");
                world.chat_log().flush();
            }
            let mut world = world_logging_to(&dir, "chat-log-restart");
            let history = init_history(&world, "c");
            let bodies: Vec<&str> = history["entries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| entry["body"].as_str().unwrap())
                .collect();
            assert_eq!(bodies, ["before the restart", "me too"]);

            join(&mut world, "c", "carol");
            drained(&mut world);
            type_line(&mut world, "c", "after");
            assert_eq!(
                broadcast_chats(&mut world)[0].seq,
                3,
                "order holds across restarts"
            );
            fs::remove_dir_all(&dir).ok();
        }

        #[test]
        fn a_page_request_is_answered_to_the_caller_alone() {
            let mut world = world_with("chat-log-pages", &WorldConfig::new().build());
            join(&mut world, "a", "alice");
            for i in 0..5 {
                type_line(&mut world, "a", &format!("line {i}"));
            }
            drained(&mut world);

            world.dispatch_method("a", CHAT_HISTORY_METHOD, r#"{"before":4,"limit":2}"#);
            let replies = drained(&mut world);
            assert_eq!(replies.len(), 1);
            let (reply, filter) = &replies[0];
            assert!(matches!(filter, ClientFilter::Direct(id) if id == "a"));
            let method = reply.method.as_ref().unwrap();
            assert_eq!(method.name, CHAT_HISTORY_METHOD);
            let payload: serde_json::Value = serde_json::from_str(&method.payload).unwrap();
            assert_eq!(payload["before"], 4);
            let seqs: Vec<u64> = payload["entries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| entry["seq"].as_u64().unwrap())
                .collect();
            assert_eq!(seqs, [2, 3]);
            assert_eq!(payload["hasMore"], true);

            world.reply_chat_history("a", "not json");
            let (fallback, _) = &drained(&mut world)[0];
            let payload: serde_json::Value =
                serde_json::from_str(&fallback.method.as_ref().unwrap().payload).unwrap();
            assert_eq!(payload["entries"].as_array().unwrap().len(), 5);
        }

        #[test]
        fn a_sender_cannot_stamp_its_own_seq_or_time() {
            let forge = |world: &mut World, body: &str| {
                let mut message = Message::new(&MessageType::Chat).build();
                message.chat = Some(ChatMessage {
                    r#type: "CLIENT".to_owned(),
                    sender: "[a]".to_owned(),
                    body: body.to_owned(),
                    seq: 99,
                    sent_at: 123.0,
                    ..Default::default()
                });
                world.on_chat("a", message);
            };

            let mut world = world_with("chat-log-forged", &WorldConfig::new().build());
            join(&mut world, "a", "alice");
            drained(&mut world);
            forge(&mut world, "   ");
            forge(&mut world, "real line");
            let chats = broadcast_chats(&mut world);
            assert_eq!(chats.len(), 2);
            assert_eq!(
                (chats[0].seq, chats[0].sent_at),
                (0, 0.0),
                "an unlogged line carries no stamp"
            );
            assert_eq!(chats[1].seq, 1, "the log numbers it, not the sender");
            assert_ne!(chats[1].sent_at, 123.0);

            let mut quiet = world_with(
                "chat-log-forged-off",
                &WorldConfig::new().chat_history_capacity(0).build(),
            );
            join(&mut quiet, "a", "alice");
            drained(&mut quiet);
            forge(&mut quiet, "hello");
            let chats = broadcast_chats(&mut quiet);
            assert_eq!((chats[0].seq, chats[0].sent_at), (0, 0.0));

            let mut posted = world_with("chat-log-forged-post", &WorldConfig::new().build());
            posted.post_chat(
                "narrator",
                "",
                "",
                ChatMessageProtocol {
                    body: "   ".to_owned(),
                    seq: 99,
                    sent_at: 123.0,
                    ..Default::default()
                },
            );
            let chats = broadcast_chats(&mut posted);
            assert_eq!(chats[0].seq, 1);
        }

        #[test]
        fn a_chat_guard_reads_rewrites_or_drops_a_line_before_it_is_logged() {
            let mut world = world_with("chat-log-guard", &WorldConfig::new().build());
            join(&mut world, "a", "alice");
            drained(&mut world);
            let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
            let heard = std::sync::Arc::clone(&seen);
            world.set_chat_guard(move |_, id, chat| {
                heard.lock().unwrap().push(format!("{id}:{}", chat.body));
                if chat.body.contains("drop me") {
                    return false;
                }
                chat.sender = "[guarded]".to_owned();
                true
            });

            type_line(&mut world, "a", "hello");
            type_line(&mut world, "a", "please drop me");
            type_line(&mut world, "a", "/tp 0 0 0");
            let chats = broadcast_chats(&mut world);
            assert_eq!(chats.len(), 1, "the dropped line is never sent");
            assert_eq!(chats[0].sender, "[guarded]", "the rewrite is what goes out");
            assert_eq!(chats[0].seq, 1);
            assert_eq!(
                *seen.lock().unwrap(),
                ["a:hello", "a:please drop me"],
                "commands never reach the guard"
            );
            let entries = world.chat_log().recent(10).entries;
            assert_eq!(entries.len(), 1, "the dropped line is never logged");
            assert_eq!(entries[0].sender, "[guarded]");
        }

        #[test]
        fn a_game_can_post_its_own_public_lines() {
            let mut world = world_with("chat-log-post", &WorldConfig::new().build());
            let seq = world.post_chat(
                "narrator",
                "",
                "",
                ChatMessageProtocol {
                    r#type: "SYSTEM".to_owned(),
                    body: "the gates open".to_owned(),
                    ..Default::default()
                },
            );
            assert_eq!(seq, Some(1));
            let chats = broadcast_chats(&mut world);
            assert_eq!(chats[0].seq, 1);
            assert_eq!(world.chat_log().recent(10).entries[0].kind, "narrator");

            let mut quiet = world_with(
                "chat-log-off",
                &WorldConfig::new().chat_history_capacity(0).build(),
            );
            assert_eq!(
                quiet.post_chat("narrator", "", "", ChatMessageProtocol::default()),
                None
            );
            assert_eq!(broadcast_chats(&mut quiet).len(), 1, "still sent");
            assert!(init_history(&quiet, "x").is_null());
        }
    }

    #[test]
    fn saved_worlds_log_beside_their_save() {
        let saved = WorldConfig::new()
            .saving(true)
            .save_dir("worlds/somewhere")
            .build();
        assert_eq!(
            ChatLog::dir_for(&saved),
            Some(PathBuf::from("worlds/somewhere").join("chat"))
        );
        let unsaved = WorldConfig::new().build();
        assert_eq!(ChatLog::dir_for(&unsaved), None);
        let explicit = WorldConfig::new().chat_log_dir("runtime/chat").build();
        assert_eq!(
            ChatLog::dir_for(&explicit),
            Some(PathBuf::from("runtime/chat"))
        );
        let off = WorldConfig::new()
            .saving(true)
            .save_dir("worlds/somewhere")
            .chat_history_capacity(0)
            .build();
        assert_eq!(ChatLog::dir_for(&off), None);
    }
}
