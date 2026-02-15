export type FindSimilarOptions = {
  maxSuggestions?: number;
};

export const toLowerCaseIfNeeded = (value: string): string => {
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

const splitOnDashOrUnderscore = (value: string): string[] | null => {
  let delimiterIndex = -1;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 45 || code === 95) {
      delimiterIndex = index;
      break;
    }
  }
  if (delimiterIndex < 0) {
    return null;
  }

  const parts: string[] = [];
  let segmentStart = 0;
  for (let index = delimiterIndex; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code !== 45 && code !== 95) {
      continue;
    }
    parts.push(value.slice(segmentStart, index));
    segmentStart = index + 1;
  }
  parts.push(value.slice(segmentStart));
  return parts;
};

export function findSimilar(
  target: string,
  available: string[],
  options: FindSimilarOptions = {}
): string[] {
  const { maxSuggestions = 3 } = options;
  const targetLower = toLowerCaseIfNeeded(target);
  const targetParts = splitOnDashOrUnderscore(targetLower);
  const scored: Array<{ name: string; score: number }> = [];

  for (let nameIndex = 0; nameIndex < available.length; nameIndex++) {
    const name = available[nameIndex];
    const nameLower = toLowerCaseIfNeeded(name);
    let score = 0;

    if (nameLower.includes(targetLower) || targetLower.includes(nameLower)) {
      score += 10;
    }

    const nameParts = splitOnDashOrUnderscore(nameLower);
    if (targetParts) {
      if (nameParts) {
        for (let targetPartIndex = 0; targetPartIndex < targetParts.length; targetPartIndex++) {
          const tp = targetParts[targetPartIndex];
          for (let namePartIndex = 0; namePartIndex < nameParts.length; namePartIndex++) {
            const np = nameParts[namePartIndex];
            if (tp === np) score += 5;
            else if (tp.includes(np) || np.includes(tp)) score += 2;
          }
        }
      } else {
        for (let targetPartIndex = 0; targetPartIndex < targetParts.length; targetPartIndex++) {
          const tp = targetParts[targetPartIndex];
          if (tp === nameLower) score += 5;
          else if (tp.includes(nameLower) || nameLower.includes(tp)) score += 2;
        }
      }
    } else if (nameParts) {
      for (let namePartIndex = 0; namePartIndex < nameParts.length; namePartIndex++) {
        const np = nameParts[namePartIndex];
        if (targetLower === np) score += 5;
        else if (targetLower.includes(np) || np.includes(targetLower)) score += 2;
      }
    } else {
      if (targetLower === nameLower) score += 5;
      else if (targetLower.includes(nameLower) || nameLower.includes(targetLower)) score += 2;
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
