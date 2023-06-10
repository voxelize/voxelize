use crate::event::Event;

pub trait Handler<S, E: Event, T: 'static> {
    // fn handle(&self, system: &mut S, event: &E, context: &mut T);
}
