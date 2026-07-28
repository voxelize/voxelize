use hashbrown::HashSet;

/// Per-world waterlogging policy derived from the block registry.
#[derive(Debug, Clone)]
pub struct WaterloggingRules {
    pub fluid_id: u32,
    pub waterloggable_ids: HashSet<u32>,
}

#[cfg(test)]
mod registry_waterlogging_rules_tests {
    use super::*;
    use crate::{Block, Registry};

    #[test]
    fn registry_with_waterlogging_fluid_yields_rules() {
        let mut registry = Registry::new();
        registry.register_block(
            &Block::new("Water")
                .id(10)
                .is_fluid(true)
                .is_waterlogging_fluid(true)
                .build(),
        );
        registry.register_block(
            &Block::new("Kelp")
                .id(20)
                .is_waterloggable(true)
                .build(),
        );

        let rules = registry
            .waterlogging_rules()
            .expect("waterlogging fluid registered");
        assert_eq!(rules.fluid_id, 10);
        assert!(rules.waterloggable_ids.contains(&20));
    }

    #[test]
    fn registry_without_waterlogging_fluid_yields_none() {
        let registry = Registry::new();
        assert!(registry.waterlogging_rules().is_none());
    }
}
