use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use crossbeam_channel::{Receiver, Sender};
use log::error;
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{
    common::ClientFilter,
    encode_message, perf,
    server::Message,
    world::shared_pools::{encode_pool, InflightJob, ENCODE_INFLIGHT},
    EntityOperation, MessageType,
};

#[derive(Clone)]
pub struct EncodedMessage {
    pub data: Vec<u8>,
    pub msg_type: i32,
    pub is_rtc_eligible: bool,
    pub perf: Option<perf::OutboundPerf>,
    /// Chunks carried, so the chunk-send log can name its payload.
    pub chunk_count: usize,
    /// When the message left the tick that produced it for the encoder. The
    /// gap to the tick that hands the bytes to the socket is the encode
    /// round trip a chunk load pays on top of its pipeline.
    pub queued_at: Instant,
    pub encode_ms: f32,
}

/// The RELIABLE ORDERED EVENTS channel of the state replication split (see
/// `world::replication` for the full taxonomy).
///
/// Everything staged here is a fact the client must receive exactly once and
/// in order: chat, voxel/chunk updates, entity CREATE / DELETE / OUT_OF_RANGE
/// transitions, join/leave, methods, events. Messages are drained FIFO every
/// tick by the broadcast system and are never dropped.
///
/// Do NOT push high-frequency positional/metadata UPDATE state through this
/// queue — that is what [`crate::ReplicatedStateBuffer`] (latest-wins slots)
/// is for. A FIFO of positions replays the past and makes entities and
/// players rubber-band.
pub struct MessageQueues {
    critical: Vec<(Message, ClientFilter)>,
    normal: Vec<(Message, ClientFilter)>,
    bulk: Vec<(Message, ClientFilter)>,
}

impl MessageQueues {
    pub fn new() -> Self {
        Self {
            critical: Vec::new(),
            normal: Vec::new(),
            bulk: Vec::new(),
        }
    }

    pub fn queue_stats(&self) -> (usize, usize, usize) {
        (self.critical.len(), self.normal.len(), self.bulk.len())
    }

    pub fn push(&mut self, item: (Message, ClientFilter)) {
        let (message, filter) = item;
        match MessageType::try_from(message.r#type) {
            Ok(MessageType::Peer)
            | Ok(MessageType::Entity)
            | Ok(MessageType::Event)
            | Ok(MessageType::Chat)
            | Ok(MessageType::Join)
            | Ok(MessageType::Leave) => {
                self.critical.push((message, filter));
            }
            Ok(MessageType::Load) | Ok(MessageType::Unload) => {
                self.bulk.push((message, filter));
            }
            _ => {
                self.normal.push((message, filter));
            }
        }
    }

    pub fn drain_prioritized(&mut self) -> Vec<(Message, ClientFilter)> {
        let mut result =
            Vec::with_capacity(self.critical.len() + self.normal.len() + self.bulk.len());
        result.append(&mut self.critical);
        result.append(&mut self.normal);
        result.append(&mut self.bulk);
        result
    }
}

/// Once the reorder buffer has held this many completed batches waiting on a
/// single missing `next_release_seq` (almost certainly a panicked encode
/// job — see `process()`), it force-advances instead of buffering forever.
/// Named per `chunk-pipeline`'s "queues account for everything they pop":
/// this is a bounded drop, logged, not a silent stall.
const REORDER_STALL_LIMIT: usize = 64;

pub struct EncodedMessageQueue {
    pub pending: Vec<(Message, ClientFilter)>,
    pub processed: Vec<(EncodedMessage, ClientFilter)>,
    sender: Arc<Sender<(u64, Vec<(EncodedMessage, ClientFilter)>)>>,
    receiver: Arc<Receiver<(u64, Vec<(EncodedMessage, ClientFilter)>)>>,
    /// Sequence handed to the next `process()` batch.
    next_process_seq: u64,
    /// Sequence `receive()` is waiting to release next. Batches that finish
    /// encoding out of order are held in `reorder_buffer` until their turn.
    next_release_seq: u64,
    reorder_buffer: BTreeMap<u64, Vec<(EncodedMessage, ClientFilter)>>,
}

impl EncodedMessageQueue {
    pub fn new() -> Self {
        let (sender, receiver) = crossbeam_channel::unbounded();
        Self {
            pending: vec![],
            processed: vec![],
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            next_process_seq: 0,
            next_release_seq: 0,
            reorder_buffer: BTreeMap::new(),
        }
    }

    pub fn queue_stats(&self) -> (usize, usize) {
        (self.pending.len(), self.reorder_buffer.len())
    }

    pub fn append(&mut self, mut list: Vec<(Message, ClientFilter)>) {
        self.pending.append(&mut list);
    }

    /// Encodes this tick's batch on the shared encode pool. Batches are
    /// parallel-encoded internally (order preserved within a batch) but
    /// multiple batches can be in flight on the pool at once, so a smaller
    /// later batch can finish before an earlier larger one. Each batch is
    /// stamped with a monotonic `seq` here; `receive()` only ever releases
    /// batches in that order, so reliable messages (voxel UPDATEs, chunk
    /// LOADs, entity lifecycle) reach clients in the order they were sent.
    pub fn process(&mut self) {
        let all_pending: Vec<(Message, ClientFilter)> = self.pending.drain(..).collect();
        if all_pending.is_empty() {
            return;
        }

        let seq = self.next_process_seq;
        self.next_process_seq += 1;

        let sender = Arc::clone(&self.sender);
        let queued_at = Instant::now();
        InflightJob::queue(&ENCODE_INFLIGHT, 1);
        encode_pool().spawn_fifo(move || {
            let _inflight = InflightJob::adopt(&ENCODE_INFLIGHT);
            let encoded: Vec<(EncodedMessage, ClientFilter)> = all_pending
                .into_par_iter()
                .map(|(message, filter)| {
                    let msg_type = message.r#type;
                    let is_rtc_eligible = Self::compute_rtc_eligibility(&message);
                    let outbound_perf = perf::outbound(&message);
                    let chunk_count = message.chunks.len();
                    let started = Instant::now();
                    let data = encode_message(&message);
                    let encoded = EncodedMessage {
                        data,
                        msg_type,
                        is_rtc_eligible,
                        perf: outbound_perf,
                        chunk_count,
                        queued_at,
                        encode_ms: started.elapsed().as_secs_f32() * 1000.0,
                    };
                    (encoded, filter)
                })
                .collect();
            let _ = sender.send((seq, encoded));
        });
    }

    /// Drains completed batches and releases them strictly in `process()`
    /// submission order, holding any that finished early in
    /// `reorder_buffer` until the batch(es) ahead of them arrive.
    pub fn receive(&mut self) -> Vec<(EncodedMessage, ClientFilter)> {
        while let Ok((seq, messages)) = self.receiver.try_recv() {
            self.reorder_buffer.insert(seq, messages);
        }

        if self.reorder_buffer.len() >= REORDER_STALL_LIMIT
            && !self.reorder_buffer.contains_key(&self.next_release_seq)
        {
            let stuck = self.next_release_seq;
            let resume_at = *self.reorder_buffer.keys().next().unwrap();
            error!(
                "[messages] encode batch seq={} never arrived after {} later batches piled up \
                 behind it (likely a panicked encode job) — skipping ahead to seq={} so \
                 delivery is not stalled forever",
                stuck,
                self.reorder_buffer.len(),
                resume_at
            );
            self.next_release_seq = resume_at;
        }

        let mut result = Vec::new();
        while let Some(messages) = self.reorder_buffer.remove(&self.next_release_seq) {
            result.extend(messages);
            self.next_release_seq += 1;
        }
        result
    }

    fn compute_rtc_eligibility(message: &Message) -> bool {
        match MessageType::try_from(message.r#type) {
            Ok(MessageType::Entity) => {
                !message.entities.is_empty()
                    && message.entities.iter().all(|e| {
                        EntityOperation::try_from(e.operation) == Ok(EntityOperation::Update)
                    })
            }
            Ok(MessageType::Peer) => true,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An `EncodedMessage` tagged with `chunk_count` so a test can tell
    /// batches apart without going through real encoding.
    fn tagged(tag: usize) -> EncodedMessage {
        EncodedMessage {
            data: vec![tag as u8],
            msg_type: MessageType::Update as i32,
            is_rtc_eligible: false,
            perf: None,
            chunk_count: tag,
            queued_at: Instant::now(),
            encode_ms: 0.0,
        }
    }

    // Reproduces the bug behind "server messages always arrive in the order
    // they were sent": two `process()` batches racing on the shared encode
    // pool, with the later tick's (seq 1) finishing first.
    #[test]
    fn receive_releases_batches_in_submission_order_even_when_they_finish_reversed() {
        let mut queue = EncodedMessageQueue::new();
        queue.next_process_seq = 2; // as if two process() calls already ran

        queue
            .sender
            .send((1, vec![(tagged(20), ClientFilter::All)]))
            .expect("channel open");

        // seq 0 hasn't shown up yet, so the seq-1 batch must not jump ahead.
        assert!(queue.receive().is_empty());
        assert_eq!(queue.reorder_buffer.len(), 1);

        queue
            .sender
            .send((0, vec![(tagged(10), ClientFilter::All)]))
            .expect("channel open");

        let released = queue.receive();
        let tags: Vec<usize> = released.iter().map(|(m, _)| m.chunk_count).collect();
        assert_eq!(
            tags,
            vec![10, 20],
            "seq 0's batch must be released before seq 1's, in send order, not completion order"
        );
        assert!(queue.reorder_buffer.is_empty());
        assert_eq!(queue.next_release_seq, 2);
    }

    #[test]
    fn receive_holds_multiple_early_arrivals_until_their_turn() {
        let mut queue = EncodedMessageQueue::new();
        queue.next_process_seq = 3;

        // Batches 2 and 1 both finish before batch 0.
        queue
            .sender
            .send((2, vec![(tagged(3), ClientFilter::All)]))
            .unwrap();
        queue
            .sender
            .send((1, vec![(tagged(2), ClientFilter::All)]))
            .unwrap();
        assert!(queue.receive().is_empty());
        assert_eq!(queue.reorder_buffer.len(), 2);

        queue
            .sender
            .send((0, vec![(tagged(1), ClientFilter::All)]))
            .unwrap();

        let released = queue.receive();
        let tags: Vec<usize> = released.iter().map(|(m, _)| m.chunk_count).collect();
        assert_eq!(tags, vec![1, 2, 3]);
    }

    // Named per chunk-pipeline's "queues account for everything they drop":
    // a batch that never arrives (a panicked encode job) must not stall
    // delivery forever once enough later batches pile up behind it.
    #[test]
    fn receive_skips_a_stuck_seq_once_enough_later_batches_pile_up() {
        let mut queue = EncodedMessageQueue::new();
        // seq 0 is never sent, as if its encode job panicked.
        for seq in 1..=REORDER_STALL_LIMIT as u64 {
            queue
                .sender
                .send((seq, vec![(tagged(seq as usize), ClientFilter::All)]))
                .unwrap();
        }

        let released = queue.receive();
        assert_eq!(
            released.len(),
            REORDER_STALL_LIMIT,
            "once seq 0 is given up on, every batch buffered behind it must still ship"
        );
        assert_eq!(queue.next_release_seq, REORDER_STALL_LIMIT as u64 + 1);
    }
}
