use specs::{Component, VecStorage};

#[derive(Component)]
#[storage(VecStorage)]
pub struct CountdownComp {
    pub ticks_left: u32,
    pub ticks_total: u32,
    pub finished: bool,
}

impl CountdownComp {
    /// Create a new component of a countdown.
    pub fn new(ticks_total: u32) -> Self {
        Self {
            ticks_left: ticks_total,
            ticks_total,
            finished: false,
        }
    }

    /// Tick the countdown.
    pub fn tick(&mut self) {
        if self.ticks_left > 0 {
            self.ticks_left -= 1;
        } else {
            self.finished = true;
        }
    }
}
