/// A filter for clients, used for specific broadcasting.
pub enum ClientFilter {
    All,
    Include(Vec<String>),
    Exclude(Vec<String>),
}
