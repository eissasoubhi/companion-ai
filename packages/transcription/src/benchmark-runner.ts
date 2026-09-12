import type { TranscriptLatencySample } from './types.js';
import {
  summarizeTranscriptBenchmark,
  type TranscriptBenchmarkSummary,
} from './benchmark-metrics.js';
import {
  summarizeTranscriptLatencies,
  type TranscriptLatencySummarySet,
} from './latency-metrics.js';
import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';

export interface TranscriptBenchmarkObservation {
  readonly caseId: string;
  readonly hypothesis: string;
  readonly latencySamples?: readonly TranscriptLatencySample[] | undefined;
}

export interface TranscriptBenchmarkRunReport {
  readonly providerId: string;
  readonly sampleCount: number;
  readonly accuracy: TranscriptBenchmarkSummary;
  readonly latency: TranscriptLatencySummarySet;
}

export interface TranscriptBenchmarkRunInput {
  readonly providerId: string;
  readonly corpus: readonly TranscriptBenchmarkCorpusCase[];
  readonly observations: readonly TranscriptBenchmarkObservation[];
}

function assertValidRunInput(input: TranscriptBenchmarkRunInput): void {
  if (input.providerId.trim().length === 0) {
    throw new Error('providerId must not be empty');
  }

  const corpusIds = new Set(input.corpus.map((sample) => sample.id));
  const observedIds = new Set<string>();

  for (const observation of input.observations) {
    if (!corpusIds.has(observation.caseId)) {
      throw new Error(`unknown benchmark case: ${observation.caseId}`);
    }
    if (observedIds.has(observation.caseId)) {
      throw new Error(`duplicate benchmark observation: ${observation.caseId}`);
    }
    observedIds.add(observation.caseId);
  }

  for (const sample of input.corpus) {
    if (!observedIds.has(sample.id)) {
      throw new Error(`missing benchmark observation: ${sample.id}`);
    }
  }
}

export function summarizeTranscriptBenchmarkRun(
  input: TranscriptBenchmarkRunInput,
): TranscriptBenchmarkRunReport {
  assertValidRunInput(input);

  const observationsById = new Map(input.observations.map((observation) => [observation.caseId, observation]));
  const accuracy = summarizeTranscriptBenchmark(
    input.corpus.map((sample) => {
      const observation = observationsById.get(sample.id);
      if (!observation) {
        throw new Error(`missing benchmark observation: ${sample.id}`);
      }

      return {
        id: sample.id,
        reference: sample.reference,
        hypothesis: observation.hypothesis,
        keyTerms: sample.keyTerms,
      };
    }),
  );

  const latencySamples = input.observations.flatMap((observation) => observation.latencySamples ?? []);

  return {
    providerId: input.providerId,
    sampleCount: input.corpus.length,
    accuracy,
    latency: summarizeTranscriptLatencies(latencySamples),
  };
}
