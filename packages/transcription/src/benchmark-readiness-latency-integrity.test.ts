import { describe, expect, it } from 'vitest';

import { assessTranscriptBenchmarkReadiness } from './benchmark-readiness.js';
import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';
import { summarizeTranscriptBenchmarkRun } from './benchmark-runner.js';
import type { TranscriptLatencySample } from './types.js';

const corpus = [
  {
    id: 'case-one',
    locale: 'en',
    kind: 'technical',
    reference: 'Explain Symfony',
    keyTerms: ['Symfony'],
    tags: ['technical'],
  },
] as const satisfies readonly TranscriptBenchmarkCorpusCase[];

function latency(source: 'local' | 'remote', isFinal: boolean, lagMs: number): TranscriptLatencySample {
  return {
    providerId: 'provider-a',
    sessionId: 'benchmark',
    source,
    segmentId: `${source}-${isFinal ? 'final' : 'partial'}`,
    isFinal,
    observedAtMs: 100 + lagMs,
    audioEndedAtMs: 100,
    lagMs,
  };
}

function readyCandidate() {
  const report = summarizeTranscriptBenchmarkRun({
    providerId: 'provider-a',
    corpus,
    observations: [
      {
        caseId: 'case-one',
        hypothesis: 'Explain Symfony',
        latencySamples: [
          latency('local', false, 20),
          latency('local', true, 40),
          latency('remote', false, 30),
          latency('remote', true, 50),
        ],
      },
    ],
  });

  return {
    report,
    operational: {
      providerId: 'provider-a',
      endpointFinalizationP95Ms: 120,
      reconnectSuccessRate: 1,
      recoveryP95Ms: 350,
      falseFinalizationRate: 0.02,
      costPerLiveHourTwoChannelsUsd: 0.5,
      euProcessingAvailable: true,
    },
  } as const;
}

describe('STT benchmark latency readiness integrity', () => {
  it('rejects non-finite latency values even when sample counts are present', () => {
    const candidate = readyCandidate();
    const result = assessTranscriptBenchmarkReadiness(
      [
        {
          ...candidate,
          report: {
            ...candidate.report,
            latency: {
              ...candidate.report.latency,
              partial: { ...candidate.report.latency.partial, p95Ms: Number.NaN },
            },
          },
        },
      ],
      ['provider-a'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('provider-a: invalid partial transcript latency summary');
  });

  it('rejects impossible percentile ordering', () => {
    const candidate = readyCandidate();
    const result = assessTranscriptBenchmarkReadiness(
      [
        {
          ...candidate,
          report: {
            ...candidate.report,
            latency: {
              ...candidate.report.latency,
              final: {
                ...candidate.report.latency.final,
                p50Ms: 100,
                p95Ms: 80,
              },
            },
          },
        },
      ],
      ['provider-a'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('provider-a: invalid final transcript latency summary');
  });

  it('rejects latency sample counts that do not reconcile across dimensions', () => {
    const candidate = readyCandidate();
    const result = assessTranscriptBenchmarkReadiness(
      [
        {
          ...candidate,
          report: {
            ...candidate.report,
            latency: {
              ...candidate.report.latency,
              all: { ...candidate.report.latency.all, count: candidate.report.latency.all.count + 1 },
            },
          },
        },
      ],
      ['provider-a'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('provider-a: inconsistent transcript latency sample counts');
  });

  it('keeps a genuine summarized benchmark candidate ready', () => {
    const result = assessTranscriptBenchmarkReadiness([readyCandidate()], ['provider-a']);

    expect(result).toEqual({ ready: true, reasons: [] });
  });
});
