use std::sync::Arc;

use bytes::Bytes;
use crossbeam_channel::{Receiver, Sender};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{common::ClientFilter, encode_message, server::Message, EntityOperation, MessageType};
const SYNC_ENCODE_BATCH_LIMIT: usize = 8;
const MESSAGE_TYPE_PEER: i32 = MessageType::Peer as i32;
const MESSAGE_TYPE_ENTITY: i32 = MessageType::Entity as i32;
const MESSAGE_TYPE_EVENT: i32 = MessageType::Event as i32;
const MESSAGE_TYPE_CHAT: i32 = MessageType::Chat as i32;
const MESSAGE_TYPE_JOIN: i32 = MessageType::Join as i32;
const MESSAGE_TYPE_LEAVE: i32 = MessageType::Leave as i32;
const MESSAGE_TYPE_LOAD: i32 = MessageType::Load as i32;
const MESSAGE_TYPE_UNLOAD: i32 = MessageType::Unload as i32;
const ENTITY_OPERATION_UPDATE: i32 = EntityOperation::Update as i32;

#[inline]
fn reserve_for_append<T>(buffer: &mut Vec<T>, additional: usize) {
    let remaining_capacity = buffer.capacity() - buffer.len();
    if remaining_capacity < additional {
        buffer.reserve(additional - remaining_capacity);
    }
}

#[derive(Clone)]
pub struct EncodedMessage {
    pub data: Bytes,
    pub is_rtc_eligible: bool,
    pub is_transport_eligible: bool,
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
        match message.r#type {
            MESSAGE_TYPE_PEER
            | MESSAGE_TYPE_ENTITY
            | MESSAGE_TYPE_EVENT
            | MESSAGE_TYPE_CHAT
            | MESSAGE_TYPE_JOIN
            | MESSAGE_TYPE_LEAVE => self.critical.push((message, filter)),
            MESSAGE_TYPE_LOAD | MESSAGE_TYPE_UNLOAD => self.bulk.push((message, filter)),
            _ => self.normal.push((message, filter)),
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
            reserve_for_append(&mut self.processed, 1);
            if let Some((message, filter)) = self.pending.pop() {
                let (is_rtc_eligible, is_transport_eligible) =
                    Self::compute_delivery_eligibility(&message);
                let encoded = EncodedMessage {
                    data: Bytes::from(encode_message(&message)),
                    is_rtc_eligible,
                    is_transport_eligible,
                };
                self.processed.push((encoded, filter));
            }
            return;
        }
        if pending_len <= SYNC_ENCODE_BATCH_LIMIT {
            reserve_for_append(&mut self.processed, pending_len);
            for (message, filter) in self.pending.drain(..) {
                let (is_rtc_eligible, is_transport_eligible) =
                    Self::compute_delivery_eligibility(&message);
                let encoded = EncodedMessage {
                    data: Bytes::from(encode_message(&message)),
                    is_rtc_eligible,
                    is_transport_eligible,
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
                    let (is_rtc_eligible, is_transport_eligible) =
                        Self::compute_delivery_eligibility(&message);
                    let encoded = EncodedMessage {
                        data: Bytes::from(encode_message(&message)),
                        is_rtc_eligible,
                        is_transport_eligible,
                    };
                    (encoded, filter)
                })
                .collect();
            let _ = sender.send(encoded);
        });
    }

    pub fn receive(&mut self) -> Vec<(EncodedMessage, ClientFilter)> {
        if self.processed.is_empty() {
            if self.receiver.is_empty() {
                return Vec::new();
            }
            let mut first_batch = match self.receiver.try_recv() {
                Ok(messages) => messages,
                Err(_) => return Vec::new(),
            };
            while let Ok(mut messages) = self.receiver.try_recv() {
                reserve_for_append(&mut first_batch, messages.len());
                first_batch.append(&mut messages);
            }
            return first_batch;
        }
        let mut result = std::mem::take(&mut self.processed);
        if self.receiver.is_empty() {
            return result;
        }
        while let Ok(mut messages) = self.receiver.try_recv() {
            reserve_for_append(&mut result, messages.len());
            result.append(&mut messages);
        }
        result
    }

    #[inline]
    fn compute_delivery_eligibility(message: &Message) -> (bool, bool) {
        let message_type = message.r#type;
        let is_transport_eligible =
            message_type == MESSAGE_TYPE_ENTITY || message_type == MESSAGE_TYPE_PEER;
        if message_type != MESSAGE_TYPE_ENTITY {
            return (message_type == MESSAGE_TYPE_PEER, is_transport_eligible);
        }
        let entities = &message.entities;
        let is_rtc_eligible = match entities.as_slice() {
            [] => false,
            [entity] => entity.operation == ENTITY_OPERATION_UPDATE,
            [first, second] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, rest @ ..] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
                    && rest
                        .iter()
                        .all(|entity| entity.operation == ENTITY_OPERATION_UPDATE)
            }
        };

        (is_rtc_eligible, is_transport_eligible)
    }

    #[cfg(test)]
    fn compute_rtc_eligibility(message: &Message) -> bool {
        Self::compute_delivery_eligibility(message).0
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::{EncodedMessage, EncodedMessageQueue, MessageQueues};
    use crate::{ClientFilter, EntityOperation, EntityProtocol, Message, MessageType};

    fn encoded_marker(marker: u8) -> EncodedMessage {
        EncodedMessage {
            data: Bytes::from(vec![marker]),
            is_rtc_eligible: true,
            is_transport_eligible: true,
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
        let double_update_message = Message::new(&MessageType::Entity)
            .entities(&[update_entity.clone(), update_entity.clone()])
            .build();
        let mixed_message = Message::new(&MessageType::Entity)
            .entities(&[update_entity, delete_entity])
            .build();
        let empty_message = Message::new(&MessageType::Entity).build();

        assert!(EncodedMessageQueue::compute_rtc_eligibility(&update_message));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &double_update_message
        ));
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

    #[test]
    fn receive_merges_exactly_two_async_batches_when_processed_empty() {
        let mut queue = EncodedMessageQueue::new();
        queue
            .sender
            .send(vec![(encoded_marker(8), ClientFilter::Direct("batch-a".to_string()))])
            .unwrap();
        queue
            .sender
            .send(vec![(encoded_marker(9), ClientFilter::Direct("batch-b".to_string()))])
            .unwrap();

        let received = queue.receive();
        let payload_markers: Vec<u8> = received
            .iter()
            .map(|(encoded, _)| encoded.data[0])
            .collect();

        assert_eq!(payload_markers, vec![8, 9]);
    }

    #[test]
    fn receive_merges_exactly_two_async_batches_when_processed_non_empty() {
        let mut queue = EncodedMessageQueue::new();
        queue
            .processed
            .push((encoded_marker(7), ClientFilter::Direct("processed".to_string())));
        queue
            .sender
            .send(vec![(encoded_marker(8), ClientFilter::Direct("batch-a".to_string()))])
            .unwrap();
        queue
            .sender
            .send(vec![(encoded_marker(9), ClientFilter::Direct("batch-b".to_string()))])
            .unwrap();

        let received = queue.receive();
        let payload_markers: Vec<u8> = received
            .iter()
            .map(|(encoded, _)| encoded.data[0])
            .collect();

        assert_eq!(payload_markers, vec![7, 8, 9]);
    }
}
