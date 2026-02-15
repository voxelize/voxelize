use std::sync::Arc;

use crossbeam_channel::{Receiver, Sender};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{common::ClientFilter, encode_message, server::Message, EntityOperation, MessageType};
const SYNC_ENCODE_BATCH_LIMIT: usize = 8;

#[inline]
fn reserve_for_append<T>(buffer: &mut Vec<T>, additional: usize) {
    let remaining_capacity = buffer.capacity() - buffer.len();
    if remaining_capacity < additional {
        buffer.reserve(additional - remaining_capacity);
    }
}

#[derive(Clone)]
pub struct EncodedMessage {
    pub data: Vec<u8>,
    pub msg_type: i32,
    pub is_rtc_eligible: bool,
}

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
        let message_type = message.r#type;
        if message_type == MessageType::Peer as i32
            || message_type == MessageType::Entity as i32
            || message_type == MessageType::Event as i32
            || message_type == MessageType::Chat as i32
            || message_type == MessageType::Join as i32
            || message_type == MessageType::Leave as i32
        {
            self.critical.push((message, filter));
        } else if message_type == MessageType::Load as i32
            || message_type == MessageType::Unload as i32
        {
            self.bulk.push((message, filter));
        } else {
            self.normal.push((message, filter));
        }
    }

    pub fn drain_prioritized(&mut self) -> Vec<(Message, ClientFilter)> {
        if self.normal.is_empty() {
            if self.bulk.is_empty() {
                return std::mem::take(&mut self.critical);
            }
            if self.critical.is_empty() {
                return std::mem::take(&mut self.bulk);
            }
            let mut result = std::mem::take(&mut self.critical);
            reserve_for_append(&mut result, self.bulk.len());
            result.append(&mut self.bulk);
            return result;
        }
        if self.bulk.is_empty() {
            if self.critical.is_empty() {
                return std::mem::take(&mut self.normal);
            }
            let mut result = std::mem::take(&mut self.critical);
            reserve_for_append(&mut result, self.normal.len());
            result.append(&mut self.normal);
            return result;
        }
        if self.critical.is_empty() {
            let mut result = std::mem::take(&mut self.normal);
            reserve_for_append(&mut result, self.bulk.len());
            result.append(&mut self.bulk);
            return result;
        }
        let mut result =
            Vec::with_capacity(self.critical.len() + self.normal.len() + self.bulk.len());
        result.append(&mut self.critical);
        result.append(&mut self.normal);
        result.append(&mut self.bulk);
        result
    }
}

pub struct EncodedMessageQueue {
    pub pending: Vec<(Message, ClientFilter)>,
    pub processed: Vec<(EncodedMessage, ClientFilter)>,
    sender: Arc<Sender<Vec<(EncodedMessage, ClientFilter)>>>,
    receiver: Arc<Receiver<Vec<(EncodedMessage, ClientFilter)>>>,
}

impl EncodedMessageQueue {
    pub fn new() -> Self {
        let (sender, receiver) = crossbeam_channel::unbounded();
        Self {
            pending: vec![],
            processed: vec![],
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
        }
    }

    pub fn queue_stats(&self) -> (usize, usize) {
        (self.pending.len(), self.processed.len())
    }

    pub fn append(&mut self, mut list: Vec<(Message, ClientFilter)>) {
        if list.is_empty() {
            return;
        }
        if self.pending.is_empty() {
            self.pending = list;
            return;
        }
        reserve_for_append(&mut self.pending, list.len());
        self.pending.append(&mut list);
    }

    pub fn process(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        let pending_len = self.pending.len();
        if pending_len == 1 {
            if self.processed.capacity() == self.processed.len() {
                self.processed.reserve(1);
            }
            if let Some((message, filter)) = self.pending.pop() {
                let msg_type = message.r#type;
                let is_rtc_eligible = Self::compute_rtc_eligibility(&message);
                let encoded = EncodedMessage {
                    data: encode_message(&message),
                    msg_type,
                    is_rtc_eligible,
                };
                self.processed.push((encoded, filter));
            }
            return;
        }
        if pending_len <= SYNC_ENCODE_BATCH_LIMIT {
            reserve_for_append(&mut self.processed, pending_len);
            for (message, filter) in self.pending.drain(..) {
                let msg_type = message.r#type;
                let is_rtc_eligible = Self::compute_rtc_eligibility(&message);
                let encoded = EncodedMessage {
                    data: encode_message(&message),
                    msg_type,
                    is_rtc_eligible,
                };
                self.processed.push((encoded, filter));
            }
            return;
        }
        let all_pending = std::mem::take(&mut self.pending);

        let sender = Arc::clone(&self.sender);
        rayon::spawn_fifo(move || {
            let encoded: Vec<(EncodedMessage, ClientFilter)> = all_pending
                .into_par_iter()
                .map(|(message, filter)| {
                    let msg_type = message.r#type;
                    let is_rtc_eligible = Self::compute_rtc_eligibility(&message);
                    let encoded = EncodedMessage {
                        data: encode_message(&message),
                        msg_type,
                        is_rtc_eligible,
                    };
                    (encoded, filter)
                })
                .collect();
            sender.send(encoded).unwrap();
        });
    }

    pub fn receive(&mut self) -> Vec<(EncodedMessage, ClientFilter)> {
        let pending_batches = self.receiver.len();
        if self.processed.is_empty() && pending_batches == 0 {
            return Vec::new();
        }
        let mut result = std::mem::take(&mut self.processed);
        if pending_batches == 0 {
            return result;
        }
        if result.is_empty() {
            let mut first_batch = match self.receiver.try_recv() {
                Ok(messages) => messages,
                Err(_) => return Vec::new(),
            };
            if pending_batches == 1 {
                return first_batch;
            }
            if pending_batches == 2 {
                if let Ok(mut second_batch) = self.receiver.try_recv() {
                    first_batch.append(&mut second_batch);
                }
                return first_batch;
            }
            let mut pending_message_batches = Vec::with_capacity(pending_batches.saturating_sub(1));
            let mut pending_message_count = first_batch.len();
            while let Ok(messages) = self.receiver.try_recv() {
                pending_message_count = pending_message_count.saturating_add(messages.len());
                pending_message_batches.push(messages);
            }
            if first_batch.capacity() < pending_message_count {
                first_batch.reserve(pending_message_count - first_batch.capacity());
            }
            for mut messages in pending_message_batches {
                first_batch.append(&mut messages);
            }
            return first_batch;
        }
        if pending_batches == 1 {
            if let Ok(mut messages) = self.receiver.try_recv() {
                result.append(&mut messages);
            }
            return result;
        }
        if pending_batches == 2 {
            if let Ok(mut first_messages) = self.receiver.try_recv() {
                reserve_for_append(&mut result, first_messages.len());
                result.append(&mut first_messages);
            }
            if let Ok(mut second_messages) = self.receiver.try_recv() {
                reserve_for_append(&mut result, second_messages.len());
                result.append(&mut second_messages);
            }
            return result;
        }
        let mut pending_message_batches = Vec::with_capacity(pending_batches);
        let mut pending_message_count = 0usize;
        while let Ok(messages) = self.receiver.try_recv() {
            pending_message_count = pending_message_count.saturating_add(messages.len());
            pending_message_batches.push(messages);
        }
        reserve_for_append(&mut result, pending_message_count);
        for mut messages in pending_message_batches {
            result.append(&mut messages);
        }
        result
    }

    fn compute_rtc_eligibility(message: &Message) -> bool {
        let message_type = message.r#type;
        if message_type == MessageType::Entity as i32 {
            if message.entities.is_empty() {
                return false;
            }
            if message.entities.len() == 1 {
                return message.entities[0].operation == EntityOperation::Update as i32;
            }
            message
                .entities
                .iter()
                .all(|entity| entity.operation == EntityOperation::Update as i32)
        } else {
            message_type == MessageType::Peer as i32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{EncodedMessage, EncodedMessageQueue, MessageQueues};
    use crate::{ClientFilter, EntityOperation, EntityProtocol, Message, MessageType};

    fn encoded_marker(marker: u8) -> EncodedMessage {
        EncodedMessage {
            data: vec![marker],
            msg_type: MessageType::Peer as i32,
            is_rtc_eligible: true,
        }
    }

    #[test]
    fn message_queues_drain_prioritized_orders_by_priority_group() {
        let mut queue = MessageQueues::new();
        queue.push((
            Message::new(&MessageType::Load).build(),
            ClientFilter::Direct("load".to_string()),
        ));
        queue.push((
            Message::new(&MessageType::Update).build(),
            ClientFilter::Direct("update".to_string()),
        ));
        queue.push((
            Message::new(&MessageType::Peer).build(),
            ClientFilter::Direct("peer".to_string()),
        ));

        let drained = queue.drain_prioritized();
        assert_eq!(drained.len(), 3);
        assert_eq!(MessageType::try_from(drained[0].0.r#type), Ok(MessageType::Peer));
        assert_eq!(
            MessageType::try_from(drained[1].0.r#type),
            Ok(MessageType::Update)
        );
        assert_eq!(MessageType::try_from(drained[2].0.r#type), Ok(MessageType::Load));
    }

    #[test]
    fn message_queues_drain_prioritized_orders_critical_then_bulk_without_normal() {
        let mut queue = MessageQueues::new();
        queue.push((
            Message::new(&MessageType::Peer).build(),
            ClientFilter::Direct("peer".to_string()),
        ));
        queue.push((
            Message::new(&MessageType::Load).build(),
            ClientFilter::Direct("load".to_string()),
        ));
        queue.push((
            Message::new(&MessageType::Unload).build(),
            ClientFilter::Direct("unload".to_string()),
        ));

        let drained = queue.drain_prioritized();
        assert_eq!(drained.len(), 3);
        assert_eq!(MessageType::try_from(drained[0].0.r#type), Ok(MessageType::Peer));
        assert_eq!(MessageType::try_from(drained[1].0.r#type), Ok(MessageType::Load));
        assert_eq!(MessageType::try_from(drained[2].0.r#type), Ok(MessageType::Unload));
    }

    #[test]
    fn compute_rtc_eligibility_for_entities_requires_only_updates() {
        let update_entity = EntityProtocol {
            operation: EntityOperation::Update,
            id: "id".to_string(),
            r#type: "kind".to_string(),
            metadata: None,
        };
        let delete_entity = EntityProtocol {
            operation: EntityOperation::Delete,
            id: "id".to_string(),
            r#type: "kind".to_string(),
            metadata: None,
        };

        let update_message = Message::new(&MessageType::Entity)
            .entities(&[update_entity.clone()])
            .build();
        let mixed_message = Message::new(&MessageType::Entity)
            .entities(&[update_entity, delete_entity])
            .build();
        let empty_message = Message::new(&MessageType::Entity).build();

        assert!(EncodedMessageQueue::compute_rtc_eligibility(&update_message));
        assert!(!EncodedMessageQueue::compute_rtc_eligibility(&mixed_message));
        assert!(!EncodedMessageQueue::compute_rtc_eligibility(&empty_message));
    }

    #[test]
    fn receive_merges_processed_and_multiple_async_batches() {
        let mut queue = EncodedMessageQueue::new();
        queue
            .processed
            .push((encoded_marker(1), ClientFilter::Direct("processed".to_string())));
        queue
            .sender
            .send(vec![(encoded_marker(2), ClientFilter::Direct("batch-1".to_string()))])
            .unwrap();
        queue
            .sender
            .send(vec![
                (encoded_marker(3), ClientFilter::Direct("batch-2".to_string())),
                (encoded_marker(4), ClientFilter::Direct("batch-3".to_string())),
            ])
            .unwrap();

        let received = queue.receive();
        let payload_markers: Vec<u8> = received
            .iter()
            .map(|(encoded, _)| encoded.data[0])
            .collect();

        assert_eq!(payload_markers, vec![1, 2, 3, 4]);
        assert!(queue.processed.is_empty());
    }

    #[test]
    fn receive_merges_async_batches_when_processed_is_empty() {
        let mut queue = EncodedMessageQueue::new();
        queue
            .sender
            .send(vec![
                (encoded_marker(2), ClientFilter::Direct("batch-1".to_string())),
                (encoded_marker(3), ClientFilter::Direct("batch-2".to_string())),
            ])
            .unwrap();
        queue
            .sender
            .send(vec![(encoded_marker(4), ClientFilter::Direct("batch-3".to_string()))])
            .unwrap();

        let received = queue.receive();
        let payload_markers: Vec<u8> = received
            .iter()
            .map(|(encoded, _)| encoded.data[0])
            .collect();

        assert_eq!(payload_markers, vec![2, 3, 4]);
        assert!(queue.processed.is_empty());
    }
}
