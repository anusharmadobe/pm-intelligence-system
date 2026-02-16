export interface MatchingScore {
  string_similarity: number;
  embedding_similarity: number | null;
  type_match: number;
  composite_score: number;
}

export class EntityMatchingService {
  private normalize(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, () =>
      Array(b.length + 1).fill(0)
    );

    for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[a.length][b.length];
  }

  private jaroWinkler(a: string, b: string): number {
    if (a === b) return 1;

    const maxDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    const matchesA = new Array(a.length).fill(false);
    const matchesB = new Array(b.length).fill(false);

    let matches = 0;
    for (let i = 0; i < a.length; i += 1) {
      const start = Math.max(0, i - maxDistance);
      const end = Math.min(i + maxDistance + 1, b.length);
      for (let j = start; j < end; j += 1) {
        if (matchesB[j]) continue;
        if (a[i] !== b[j]) continue;
        matchesA[i] = true;
        matchesB[j] = true;
        matches += 1;
        break;
      }
    }

    if (matches === 0) return 0;

    let t = 0;
    let k = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (!matchesA[i]) continue;
      while (!matchesB[k]) k += 1;
      if (a[i] !== b[k]) t += 1;
      k += 1;
    }

    const transpositions = t / 2;
    const jaro =
      (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

    // Winkler adjustment
    let prefix = 0;
    for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
      if (a[i] === b[i]) prefix += 1;
      else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
  }

  score(params: {
    nameA: string;
    nameB: string;
    embeddingSimilarity?: number | null;
    typeMatch?: boolean;
  }): MatchingScore {
    const normalizedA = this.normalize(params.nameA);
    const normalizedB = this.normalize(params.nameB);
    const maxLen = Math.max(normalizedA.length, normalizedB.length) || 1;
    const levDistance = this.levenshteinDistance(normalizedA, normalizedB);
    const levSimilarity = 1 - levDistance / maxLen;
    const jaroWinkler = this.jaroWinkler(normalizedA, normalizedB);

    let stringSimilarity = (levSimilarity + jaroWinkler) / 2;
    if (
      normalizedA.length > 0 &&
      normalizedB.length > 0 &&
      (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA))
    ) {
      stringSimilarity = Math.max(stringSimilarity, 0.9);
    }
    const embeddingSimilarity =
      params.embeddingSimilarity === undefined ? null : params.embeddingSimilarity;
    const typeMatch = params.typeMatch ? 1 : 0;

    const embeddingScore = embeddingSimilarity === null ? 0 : embeddingSimilarity;
    const composite =
      stringSimilarity * 0.35 +
      embeddingScore * 0.5 +
      typeMatch * 0.15;

    return {
      string_similarity: Number(stringSimilarity.toFixed(4)),
      embedding_similarity: embeddingSimilarity,
      type_match: typeMatch,
      composite_score: Number(composite.toFixed(4))
    };
  }
}
