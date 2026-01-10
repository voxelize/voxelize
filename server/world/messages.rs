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
        match MessageType::try_from(message.r#type) {
            Ok(MessageType::Peer)
            | Ok(MessageType::Entity)
            | Ok(MessageType::Event)
            | Ok(MessageType::Chat) => {
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
        let mut result = Vec::with_capacity(
            self.critical.len() + self.normal.len() + self.bulk.len()
        );
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
        let all_pending: Vec<(Message, ClientFilter)> = self.pending.drain(..).collect();
        if all_pending.is_empty() {
            return;
        }

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
        let mut result = Vec::new();
        while let Ok(mut messages) = self.receiver.try_recv() {
            result.append(&mut messages);
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
