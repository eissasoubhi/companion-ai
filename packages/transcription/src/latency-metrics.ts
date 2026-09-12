import type { AudioSource } from '@companion-ai/contracts';

import type { TranscriptLatencySample } from './types.js';

export interface TranscriptLatencySummary {
  readonly count: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
  readonly meanMs: number | null;
}

export interface TranscriptLatencySummarySet {
  readonly all: TranscriptLatencySummary;
  readonly partial: TranscriptLatencySummary;
  readonly final: TranscriptLatencySummary;
  readonly local: TranscriptLatencySummary;
  readonly remote: TranscriptLatencySummary;
}

function percentile(sortedValues: readonly number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) return null;

  const rank = Math.ceil(percentileValue * sortedValues.length) - 1;
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank));
  return sortedValues[index] ?? null;
}

function summarize(samples: readonly TranscriptLatencySample[]): TranscriptLatencySummary {
  if (samples.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null, maxMs: null, meanMs: null };
  }

  const values = samples.map((sample) => Math.max(0, sample.lagMs)).sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.at(-1) ?? null,
    meanMs: total / values.length,
  };
}

function bySource(
  samples: readonly TranscriptLatencySample[],
  source: AudioSource,
): readonly TranscriptLatencySample[] {
  return samples.filter((sample) => sample.source === source);
}

/**
 * Produces deterministic latency summaries from emitted pipeline samples.
 * Callers own sample retention so production code can keep storage bounded.
 */
export function summarizeTranscriptLatencies(
  samples: readonly TranscriptLatencySample[],
): TranscriptLatencySummarySet {
  return {
    all: summarize(samples),
    partial: summarize(samples.filter((sample) => !sample.isFinal)),
    final: summarize(samples.filter((sample) => sample.isFinal)),
    local: summarize(bySource(samples, 'local')),
    remote: summarize(bySource(samples, 'remote')),
  };
}
