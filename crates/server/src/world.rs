pub trait EventReactor {
    fn init(&mut self);

    fn error(&mut self, error: String);

    fn entity(&mut self, entity: String);

    fn event(&mut self, event: String);

    fn chunk(&mut self, chunk: String);

    fn unchunk(&mut self, block: String);

    fn method(&mut self, method: String);

    fn stats(&mut self, stats: String);
}
