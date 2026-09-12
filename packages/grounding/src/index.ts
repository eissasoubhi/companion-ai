import type { GroundingSource, GroundingSourceKind } from '@companion-ai/contracts';

export type ContextVerificationStatus = 'verified' | 'draft' | 'archived';

export interface VerifiedContextItem {
  readonly id: string;
  readonly kind: GroundingSourceKind;
  readonly label: string;
  readonly text: string;
  readonly status: ContextVerificationStatus;
  readonly tags?: readonly string[] | undefined;
}

export interface RetrievedContext {
  readonly source: GroundingSource;
  readonly text: string;
  readonly score: number;
}

export interface VerifiedContextRetrievalConfig {
  readonly maxResults: number;
  readonly maxCharacters: number;
  readonly minimumScore: number;
}

export const defaultVerifiedContextRetrievalConfig: VerifiedContextRetrievalConfig = {
  maxResults: 4,
  maxCharacters: 4_000,
  minimumScore: 0.12,
};

const stopWords = new Set([
  'a', 'an', 'and', 'are', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'how',
  'i', 'in', 'is', 'me', 'of', 'on', 'the', 'to', 'what', 'when', 'where', 'which',
  'who', 'why', 'with', 'would', 'you', 'your', 'de', 'des', 'du', 'en', 'est', 'et',
  'je', 'la', 'le', 'les', 'moi', 'pour', 'que', 'quel', 'quelle', 'qui', 'sur', 'tu',
  'un', 'une', 'vous',
]);

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokens(value: string): ReadonlySet<string> {
  return new Set(
    normalize(value)
      .split(' ')
      .filter((token) => token.length > 1 && !stopWords.has(token)),
  );
}

function scoreItem(queryTokens: ReadonlySet<string>, item: VerifiedContextItem): number {
  if (queryTokens.size === 0) return 0;

  const bodyTokens = tokens(item.text);
  const labelTokens = tokens(item.label);
  const tagTokens = tokens(item.tags?.join(' ') ?? '');
  let weightedMatches = 0;

  for (const token of queryTokens) {
    if (bodyTokens.has(token)) weightedMatches += 1;
    if (labelTokens.has(token)) weightedMatches += 0.35;
    if (tagTokens.has(token)) weightedMatches += 0.5;
  }

  return Math.min(1, weightedMatches / queryTokens.size);
}

function validConfig(config: VerifiedContextRetrievalConfig): void {
  if (!Number.isInteger(config.maxResults) || config.maxResults < 1) {
    throw new Error('maxResults must be a positive integer.');
  }
  if (!Number.isInteger(config.maxCharacters) || config.maxCharacters < 1) {
    throw new Error('maxCharacters must be a positive integer.');
  }
  if (!Number.isFinite(config.minimumScore) || config.minimumScore < 0 || config.minimumScore > 1) {
    throw new Error('minimumScore must be between 0 and 1.');
  }
}

/**
 * Deterministic P0 retrieval baseline. Only explicitly verified material can
 * leave this boundary; draft/archived content is never returned to generation.
 */
export function retrieveVerifiedContext(
  question: string,
  items: readonly VerifiedContextItem[],
  config: VerifiedContextRetrievalConfig = defaultVerifiedContextRetrievalConfig,
): readonly RetrievedContext[] {
  validConfig(config);
  const queryTokens = tokens(question);
  if (queryTokens.size === 0) return [];

  const ranked = items
    .filter((item) => item.status === 'verified' && item.text.trim().length > 0)
    .map((item) => ({ item, score: scoreItem(queryTokens, item) }))
    .filter(({ score }) => score >= config.minimumScore)
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));

  const result: RetrievedContext[] = [];
  let usedCharacters = 0;

  for (const { item, score } of ranked) {
    if (result.length >= config.maxResults) break;

    const text = item.text.trim();
    if (usedCharacters + text.length > config.maxCharacters) continue;

    result.push({
      source: {
        id: item.id,
        kind: item.kind,
        label: item.label,
        score: Number(score.toFixed(3)),
      },
      text,
      score: Number(score.toFixed(3)),
    });
    usedCharacters += text.length;
  }

  return result;
}
