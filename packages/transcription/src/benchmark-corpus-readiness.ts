import {
  summarizeBenchmarkCorpusCoverage,
  validateBenchmarkCorpus,
  type BenchmarkLocale,
  type BenchmarkUtteranceKind,
  type TranscriptBenchmarkCorpusCase,
} from './benchmark-corpus.js';

export const requiredBenchmarkCorpusTags = [
  'code-switching',
  'background-noise',
  'accent-variation',
  'short-utterance',
  'incomplete-turn',
] as const;

export interface BenchmarkCorpusReadiness {
  readonly ready: boolean;
  readonly reasons: readonly string[];
  readonly missingTags: readonly string[];
}

const requiredLocales: readonly BenchmarkLocale[] = ['en', 'fr', 'mixed'];
const requiredKinds: readonly BenchmarkUtteranceKind[] = [
  'recruiter',
  'behavioral',
  'technical',
  'follow-up',
  'incomplete',
];

export function assessBenchmarkCorpusReadiness(
  corpus: readonly TranscriptBenchmarkCorpusCase[],
): BenchmarkCorpusReadiness {
  const reasons = [...validateBenchmarkCorpus(corpus)];
  const coverage = summarizeBenchmarkCorpusCoverage(corpus);
  const tags = new Set(corpus.flatMap((sample) => sample.tags));

  for (const locale of requiredLocales) {
    if (coverage.locales[locale] === 0) {
      reasons.push(`missing locale coverage: ${locale}`);
    }
  }

  for (const kind of requiredKinds) {
    if (coverage.kinds[kind] === 0) {
      reasons.push(`missing utterance kind coverage: ${kind}`);
    }
  }

  if (coverage.missingTechnicalTerms.length > 0) {
    reasons.push(
      `missing required technical terms: ${coverage.missingTechnicalTerms.join(', ')}`,
    );
  }

  const missingTags = requiredBenchmarkCorpusTags.filter((tag) => !tags.has(tag));
  for (const tag of missingTags) {
    reasons.push(`missing benchmark condition coverage: ${tag}`);
  }

  if (corpus.length === 0) {
    reasons.push('benchmark corpus must not be empty');
  }

  return {
    ready: reasons.length === 0,
    reasons,
    missingTags,
  };
}
