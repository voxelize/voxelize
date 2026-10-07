import { RecipeDef } from "./content";

/** Whether a recipe can be made in a `size` x `size` grid. */
export function recipeFits(recipe: RecipeDef, size: number): boolean {
  if (recipe.type === "shapeless") return recipe.ingredients.length <= size * size;
  return recipe.pattern.length <= size && recipe.pattern.every((row) => row.length <= size);
}
