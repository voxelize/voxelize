use std::sync::Arc;

use crossbeam_channel::{Receiver, Sender};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{common::ClientFilter, encode_message, server::Message, EntityOperation, MessageType};

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
            if result.capacity() - result.len() < self.bulk.len() {
                result.reserve(self.bulk.len() - (result.capacity() - result.len()));
            }
            result.append(&mut self.bulk);
            return result;
        }
        if self.bulk.is_empty() {
            if self.critical.is_empty() {
                return std::mem::take(&mut self.normal);
            }
            let mut result = std::mem::take(&mut self.critical);
            if result.capacity() - result.len() < self.normal.len() {
                result.reserve(self.normal.len() - (result.capacity() - result.len()));
            }
            result.append(&mut self.normal);
            return result;
        }
        if self.critical.is_empty() {
            let mut result = std::mem::take(&mut self.normal);
            if result.capacity() - result.len() < self.bulk.len() {
                result.reserve(self.bulk.len() - (result.capacity() - result.len()));
            }
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
        self.pending.append(&mut list);
    }

    pub fn process(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        let pending_len = self.pending.len();
        if pending_len <= 2 {
            if self.processed.capacity() - self.processed.len() < pending_len {
                self.processed
                    .reserve(pending_len - (self.processed.capacity() - self.processed.len()));
            }
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
        let mut all_pending = Vec::with_capacity(self.pending.len());
        all_pending.extend(self.pending.drain(..));

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
        if result.is_empty() && pending_batches == 1 {
            return self.receiver.try_recv().unwrap_or_default();
        }
        if pending_batches == 1 {
            if let Ok(mut messages) = self.receiver.try_recv() {
                result.append(&mut messages);
            }
            return result;
        }
        if result.capacity() - result.len() < pending_batches {
            result.reserve(pending_batches - (result.capacity() - result.len()));
        }
        while let Ok(mut messages) = self.receiver.try_recv() {
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
    use super::{EncodedMessageQueue, MessageQueues};
    use crate::{ClientFilter, EntityOperation, EntityProtocol, Message, MessageType};

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
}
