pub trait Block {
    fn id(&self) -> u32;

    fn name(&self) -> &str;
}
