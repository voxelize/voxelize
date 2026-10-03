//! Data-driven game content for the platform.
//!
//! Blocks, items, recipes, processing stations, biomes and ores are declared
//! in `platform/game/**.json` and validated here. The game server, the world
//! generator and the tools that export content to the web client and to the
//! Laravel backend all read content through [`Content`], so a key either
//! resolves everywhere or the pack fails to load.

pub mod crafting;
pub mod defs;
pub mod mining;
pub mod registry;

pub use crafting::{match_recipe, CraftMatch, CraftingGrid};
pub use defs::*;
pub use mining::{can_harvest, mining_rule, MiningModifiers, MiningRule};
pub use registry::{is_valid_key, Content, ContentSource, LoadError, ValidationErrors};

/// Location of the first-party content pack, relative to this crate.
pub fn default_pack_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../game")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack() -> Content {
        match Content::load(default_pack_dir()) {
            Ok(content) => content,
            Err(error) => panic!("{error}"),
        }
    }

    #[test]
    fn first_party_pack_is_valid() {
        let content = pack();
        let summary = content.summary();
        assert!(summary["blocks"] >= 30, "{summary:?}");
        assert!(summary["biomes"] >= 14, "{summary:?}");
        assert!(content.block("stone").is_some());
        assert_eq!(content.block_by_id(2).map(|b| b.key.as_str()), Some("stone"));
    }

    #[test]
    fn every_placeable_block_has_an_item_and_every_drop_resolves() {
        let content = pack();
        for item in content.items() {
            if let Some(block) = &item.places_block {
                assert!(content.block(block).is_some(), "{} places {}", item.key, block);
            }
        }
        for block in content.blocks() {
            for drop in &block.drops {
                assert!(content.item(&drop.item).is_some(), "{} drops {}", block.key, drop.item);
            }
        }
    }

    #[test]
    fn validation_reports_every_problem_at_once() {
        let mut source = ContentSource::read_dir(default_pack_dir()).unwrap();
        source.blocks[0].key = "Bad Key".into();
        source.blocks[1].id = source.blocks[2].id;
        source.items[0].places_block = Some("nowhere".into());
        source.ores[0].min_y = 500;
        let errors = Content::build(source).unwrap_err();
        let text = errors.to_string();
        assert!(text.contains("not lowercase snake_case"), "{text}");
        assert!(text.contains("is used by both"), "{text}");
        assert!(text.contains("unknown block \"nowhere\""), "{text}");
        assert!(text.contains("minY must be below maxY"), "{text}");
    }

    #[test]
    fn air_id_is_reserved() {
        let mut source = ContentSource::read_dir(default_pack_dir()).unwrap();
        source.blocks[0].id = 0;
        let errors = Content::build(source).unwrap_err();
        assert!(errors.to_string().contains("reserved"));
    }

    #[test]
    fn shaped_recipe_with_undefined_symbol_is_rejected() {
        let mut source = ContentSource::read_dir(default_pack_dir()).unwrap();
        source.recipes.push(RecipeDef::Shaped {
            key: "broken".into(),
            pattern: vec!["#x".into()],
            symbols: [('#', "planks".to_owned())].into_iter().collect(),
            result: ItemStack {
                item: "stick".into(),
                count: 1,
            },
            mirrored: true,
        });
        let text = Content::build(source).unwrap_err().to_string();
        assert!(text.contains("undefined symbol 'x'"), "{text}");
    }

    #[test]
    fn mining_needs_the_right_tool_to_harvest() {
        let content = pack();
        let stone = content.block("stone").unwrap();
        let wooden = content.item("wooden_pickaxe").unwrap();
        let stone_pick = content.item("stone_pickaxe").unwrap();

        let bare = mining_rule(stone, None, MiningModifiers::default());
        let with_wood = mining_rule(stone, Some(wooden), MiningModifiers::default());
        let with_stone = mining_rule(stone, Some(stone_pick), MiningModifiers::default());

        match (bare, with_wood, with_stone) {
            (
                MiningRule::Breakable { millis: bare_ms, harvests: false },
                MiningRule::Breakable { millis: wood_ms, harvests: true },
                MiningRule::Breakable { millis: stone_ms, harvests: true },
            ) => {
                assert_eq!(bare_ms, 7500);
                assert_eq!(wood_ms, 1125);
                assert!(stone_ms < wood_ms);
            }
            other => panic!("unexpected {other:?}"),
        }

        // Tier gates: gold needs an iron-tier pickaxe.
        let gold = content.block("gold_ore").unwrap();
        assert!(!can_harvest(gold, Some(stone_pick)));
        assert!(can_harvest(gold, content.item("iron_pickaxe")));
    }

    #[test]
    fn soil_drops_by_hand_and_bedrock_never_breaks() {
        let content = pack();
        assert!(can_harvest(content.block("dirt").unwrap(), None));
        assert_eq!(
            mining_rule(content.block("bedrock").unwrap(), None, MiningModifiers::default()),
            MiningRule::Unbreakable
        );
        let shovel = content.item("stone_shovel");
        let dirt = content.block("dirt").unwrap();
        let by_hand = mining_rule(dirt, None, MiningModifiers::default());
        let by_shovel = mining_rule(dirt, shovel, MiningModifiers::default());
        assert!(by_shovel.min_break_millis(1.0) < by_hand.min_break_millis(1.0));
    }

    #[test]
    fn mining_in_the_air_or_under_water_is_slower() {
        let content = pack();
        let dirt = content.block("dirt").unwrap();
        let ground = mining_rule(dirt, None, MiningModifiers::default()).min_break_millis(1.0);
        let air = mining_rule(
            dirt,
            None,
            MiningModifiers {
                on_ground: false,
                ..Default::default()
            },
        )
        .min_break_millis(1.0);
        assert_eq!(air.unwrap(), ground.unwrap() * 5);
    }

    #[test]
    fn crafting_matches_shaped_anywhere_in_the_grid() {
        let content = pack();
        let p = Some("planks");
        let grid = CraftingGrid::from_rows(&[&[None, None, None], &[None, p, None], &[None, p, None]]);
        let found = match_recipe(&content, &grid).expect("sticks");
        assert_eq!(found.recipe, "stick");
        assert_eq!(found.result.count, 4);
        assert_eq!(found.consumed, vec![(1, 1), (1, 2)]);
    }

    #[test]
    fn crafting_honours_mirroring() {
        let content = pack();
        let i = Some("planks");
        let s = Some("stick");
        let normal = CraftingGrid::from_rows(&[&[i, i, None], &[i, s, None], &[None, s, None]]);
        let mirrored = CraftingGrid::from_rows(&[&[None, i, i], &[None, s, i], &[None, s, None]]);
        assert_eq!(match_recipe(&content, &normal).unwrap().recipe, "wooden_axe");
        assert_eq!(match_recipe(&content, &mirrored).unwrap().recipe, "wooden_axe");
    }

    #[test]
    fn crafting_shapeless_and_rejects_extra_items() {
        let content = pack();
        let log = CraftingGrid::from_rows(&[&[None, None], &[None, Some("oak_log")]]);
        assert_eq!(match_recipe(&content, &log).unwrap().recipe, "planks_from_oak");

        let extra = CraftingGrid::from_rows(&[&[Some("dirt"), None], &[None, Some("oak_log")]]);
        assert!(match_recipe(&content, &extra).is_none());
        assert!(match_recipe(&content, &CraftingGrid::new(3)).is_none());
    }

    #[test]
    fn same_shape_different_material_picks_the_right_recipe() {
        let content = pack();
        let ring = |m: &'static str| {
            let x = Some(m);
            CraftingGrid::from_rows(&[&[x, x, x], &[x, None, x], &[x, x, x]])
        };
        assert_eq!(match_recipe(&content, &ring("rubble")).unwrap().recipe, "furnace");
        assert_eq!(match_recipe(&content, &ring("planks")).unwrap().recipe, "chest");
        assert!(match_recipe(&content, &ring("dirt")).is_none());
    }

    #[test]
    fn processing_lookup_and_fuel() {
        let content = pack();
        let smelt = content.processing_for("furnace", "raw_iron").unwrap();
        assert_eq!(smelt.output.item, "iron_ingot");
        assert_eq!(content.fuel_ticks("coal"), Some(1600));
        assert_eq!(content.fuel_ticks("dirt"), None);
    }
}
