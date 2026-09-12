export interface TranscriptBenchmarkSample {
  readonly id: string;
  readonly reference: string;
  readonly hypothesis: string;
  readonly keyTerms?: readonly string[] | undefined;
}

export interface TranscriptBenchmarkSampleResult {
  readonly id: string;
  readonly wordErrorRate: number;
  readonly keyTermAccuracy: number | null;
  readonly keyTermCount: number;
  readonly keyTermMatches: number;
  readonly referenceWordCount: number;
}

export interface TranscriptBenchmarkSummary {
  readonly sampleCount: number;
  readonly referenceWordCount: number;
  readonly wordErrorRate: number;
  readonly keyTermAccuracy: number | null;
  readonly keyTermCount: number;
  readonly keyTermMatches: number;
  readonly samples: readonly TranscriptBenchmarkSampleResult[];
}

const combiningMarks = /\p{M}+/gu;
const punctuation = /[^\p{L}\p{N}+#./-]+/gu;

export function normalizeTranscriptText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(combiningMarks, '')
    .toLocaleLowerCase('en-US')
    .replace(punctuation, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function tokenize(text: string): string[] {
  const normalized = normalizeTranscriptText(text);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

function levenshteinDistance(reference: readonly string[], hypothesis: readonly string[]): number {
  const previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  const current = new Array<number>(hypothesis.length + 1);

  for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex += 1) {
    current[0] = referenceIndex;
    const referenceToken = reference[referenceIndex - 1];

    for (let hypothesisIndex = 1; hypothesisIndex <= hypothesis.length; hypothesisIndex += 1) {
      const hypothesisToken = hypothesis[hypothesisIndex - 1];
      const substitutionCost = referenceToken === hypothesisToken ? 0 : 1;
      current[hypothesisIndex] = Math.min(
        (current[hypothesisIndex - 1] ?? 0) + 1,
        (previous[hypothesisIndex] ?? 0) + 1,
        (previous[hypothesisIndex - 1] ?? 0) + substitutionCost,
      );
    }

    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }

  return previous[hypothesis.length] ?? 0;
}

export function calculateWordErrorRate(reference: string, hypothesis: string): number {
  const referenceTokens = tokenize(reference);
  const hypothesisTokens = tokenize(hypothesis);

  if (referenceTokens.length === 0) {
    return hypothesisTokens.length === 0 ? 0 : 1;
  }

  return levenshteinDistance(referenceTokens, hypothesisTokens) / referenceTokens.length;
}

function countKeyTermMatches(
  hypothesis: string,
  keyTerms: readonly string[],
): { readonly matches: number; readonly count: number } {
  const normalizedHypothesis = ` ${normalizeTranscriptText(hypothesis)} `;
  let matches = 0;
  let count = 0;

  for (const term of keyTerms) {
    const normalizedTerm = normalizeTranscriptText(term);
    if (normalizedTerm.length === 0) {
      continue;
    }

    count += 1;
    if (normalizedHypothesis.includes(` ${normalizedTerm} `)) {
      matches += 1;
    }
  }

  return { matches, count };
}

export function calculateKeyTermAccuracy(
  hypothesis: string,
  keyTerms: readonly string[],
): number | null {
  const { matches, count } = countKeyTermMatches(hypothesis, keyTerms);
  return count === 0 ? null : matches / count;
}

export function summarizeTranscriptBenchmark(
  samples: readonly TranscriptBenchmarkSample[],
): TranscriptBenchmarkSummary {
  const results = samples.map((sample) => {
    const referenceWordCount = tokenize(sample.reference).length;
    const keyTermStats = countKeyTermMatches(sample.hypothesis, sample.keyTerms ?? []);
    return {
      id: sample.id,
      wordErrorRate: calculateWordErrorRate(sample.reference, sample.hypothesis),
      keyTermAccuracy:
        keyTermStats.count === 0 ? null : keyTermStats.matches / keyTermStats.count,
      keyTermCount: keyTermStats.count,
      keyTermMatches: keyTermStats.matches,
      referenceWordCount,
    } satisfies TranscriptBenchmarkSampleResult;
  });

  const referenceWordCount = results.reduce((sum, sample) => sum + sample.referenceWordCount, 0);
  const weightedErrors = results.reduce(
    (sum, sample) => sum + sample.wordErrorRate * sample.referenceWordCount,
    0,
  );
  const keyTermCount = results.reduce((sum, sample) => sum + sample.keyTermCount, 0);
  const keyTermMatches = results.reduce((sum, sample) => sum + sample.keyTermMatches, 0);

  return {
    sampleCount: results.length,
    referenceWordCount,
    wordErrorRate: referenceWordCount === 0 ? 0 : weightedErrors / referenceWordCount,
    keyTermAccuracy: keyTermCount === 0 ? null : keyTermMatches / keyTermCount,
    keyTermCount,
    keyTermMatches,
    samples: results,
  };
}
