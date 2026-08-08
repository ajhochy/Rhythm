const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Tokenize text with the existing deduped-token skill retrieval semantics. */
export function tokenize(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const word = raw.replace(/^[.,!?";:()[\]]+/, '').replace(/[.,!?";:()[\]]+$/, '');
    if (word.length > 1) out.add(word);
  }
  return out;
}

/** Score documents using the existing corpus-aware, deduped-token BM25 algorithm. */
export function scoreDocsBm25(query: string, documents: readonly string[]): number[] {
  if (documents.length === 0) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return documents.map(() => 0);
  const tokenizedDocuments = documents.map(tokenize);
  const averageLength =
    tokenizedDocuments.reduce((sum, document) => sum + document.size, 0) /
    tokenizedDocuments.length;

  return tokenizedDocuments.map((document) => {
    let score = 0;
    for (const term of queryTokens) {
      if (!document.has(term)) continue;
      const documentFrequency = tokenizedDocuments.reduce(
        (count, candidate) => count + (candidate.has(term) ? 1 : 0),
        0,
      );
      const idf = Math.log(
        1 +
          (tokenizedDocuments.length - documentFrequency + 0.5) /
            (documentFrequency + 0.5),
      );
      const lengthNormalization =
        1 - BM25_B + BM25_B * (document.size / Math.max(averageLength, 1));
      score += idf * ((BM25_K1 + 1) / (1 + BM25_K1 * lengthNormalization));
    }
    return score;
  });
}
