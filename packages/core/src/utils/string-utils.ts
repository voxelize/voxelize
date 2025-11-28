export type FindSimilarOptions = {
  maxSuggestions?: number;
};

export function findSimilar(
  target: string,
  available: string[],
  options: FindSimilarOptions = {}
): string[] {
  const { maxSuggestions = 3 } = options;
  const targetLower = target.toLowerCase();

  const scored = available.map((name) => {
    const nameLower = name.toLowerCase();
    let score = 0;

    if (nameLower.includes(targetLower) || targetLower.includes(nameLower)) {
      score += 10;
    }

    const targetParts = targetLower.split(/[-_]/);
    const nameParts = nameLower.split(/[-_]/);
    for (const tp of targetParts) {
      for (const np of nameParts) {
        if (tp === np) score += 5;
        else if (tp.includes(np) || np.includes(tp)) score += 2;
      }
    }

    if (targetLower[0] === nameLower[0]) score += 1;

    return { name, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions)
    .map((s) => s.name);
}

export type FormatSuggestionOptions = {
  maxFallbackItems?: number;
};

export function formatSuggestion(
  suggestions: string[],
  allAvailable: string[],
  options: FormatSuggestionOptions = {}
): string {
  const { maxFallbackItems = 10 } = options;

  if (suggestions.length > 0) {
    return ` Maybe you meant: ${suggestions.map((s) => `"${s}"`).join(", ")}?`;
  }

  const truncated = allAvailable.slice(0, maxFallbackItems);
  const suffix = allAvailable.length > maxFallbackItems ? "..." : "";
  return ` Available: ${truncated.map((s) => `"${s}"`).join(", ")}${suffix}`;
}
