export type FindSimilarOptions = {
  maxSuggestions?: number;
};

const normalizeCaseIfNeeded = (value: string): string => {
  let hasNonAscii = false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 65 && code <= 90) {
      return value.toLowerCase();
    }
    if (code > 127) {
      hasNonAscii = true;
    }
  }
  if (!hasNonAscii) {
    return value;
  }
  for (const char of value) {
    if (char.toLowerCase() !== char.toUpperCase() && char === char.toUpperCase()) {
      return value.toLowerCase();
    }
  }
  return value;
};

export function findSimilar(
  target: string,
  available: string[],
  options: FindSimilarOptions = {}
): string[] {
  const { maxSuggestions = 3 } = options;
  const targetLower = normalizeCaseIfNeeded(target);
  const targetParts = targetLower.split(/[-_]/);
  const scored: Array<{ name: string; score: number }> = [];

  for (let nameIndex = 0; nameIndex < available.length; nameIndex++) {
    const name = available[nameIndex];
    const nameLower = normalizeCaseIfNeeded(name);
    let score = 0;

    if (nameLower.includes(targetLower) || targetLower.includes(nameLower)) {
      score += 10;
    }

    const nameParts = nameLower.split(/[-_]/);
    for (let targetPartIndex = 0; targetPartIndex < targetParts.length; targetPartIndex++) {
      const tp = targetParts[targetPartIndex];
      for (let namePartIndex = 0; namePartIndex < nameParts.length; namePartIndex++) {
        const np = nameParts[namePartIndex];
        if (tp === np) score += 5;
        else if (tp.includes(np) || np.includes(tp)) score += 2;
      }
    }

    if (targetLower[0] === nameLower[0]) score += 1;

    if (score > 0) {
      scored.push({ name, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length > maxSuggestions) {
    scored.length = maxSuggestions;
  }

  const suggestions = new Array<string>(scored.length);
  for (let index = 0; index < scored.length; index++) {
    suggestions[index] = scored[index].name;
  }

  return suggestions;
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
    let output = " Maybe you meant: ";
    for (let index = 0; index < suggestions.length; index++) {
      if (index > 0) {
        output += ", ";
      }
      output += `"${suggestions[index]}"`;
    }
    return `${output}?`;
  }

  const truncatedCount = Math.min(allAvailable.length, maxFallbackItems);
  const suffix = allAvailable.length > truncatedCount ? "..." : "";
  let availableText = " Available: ";
  for (let index = 0; index < truncatedCount; index++) {
    if (index > 0) {
      availableText += ", ";
    }
    availableText += `"${allAvailable[index]}"`;
  }
  return `${availableText}${suffix}`;
}
