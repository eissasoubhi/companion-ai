import { describe, expect, it } from 'vitest';

import { assessTranscriptBenchmarkReadiness } from './benchmark-readiness.js';
import { summarizeTranscriptBenchmarkRun } from './benchmark-runner.js';
import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';
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

function latency(
  providerId: string,
  source: 'local' | 'remote',
  isFinal: boolean,
  lagMs: number,
): TranscriptLatencySample {
  return {
    providerId,
    sessionId: 'benchmark',
    source,
    segmentId: `${source}-${isFinal ? 'final' : 'partial'}`,
    isFinal,
    observedAtMs: 100 + lagMs,
    audioEndedAtMs: 100,
    lagMs,
  };
}

function candidate(providerId = 'provider-a') {
  const report = summarizeTranscriptBenchmarkRun({
    providerId,
    corpus,
    observations: [
      {
        caseId: 'case-one',
        hypothesis: 'Explain Symfony',
        latencySamples: [
          latency(providerId, 'local', false, 20),
          latency(providerId, 'local', true, 40),
          latency(providerId, 'remote', false, 30),
          latency(providerId, 'remote', true, 50),
        ],
      },
    ],
  });

  return {
    report,
    operational: {
      endpointFinalizationP95Ms: 120,
      reconnectSuccessRate: 1,
      recoveryP95Ms: 350,
      falseFinalizationRate: 0.02,
      costPerLiveHourTwoChannelsUsd: 0.5,
      euProcessingAvailable: true,
    },
  } as const;
}

describe('assessTranscriptBenchmarkReadiness', () => {
  it('is ready only when every required provider has complete measured evidence', () => {
    const result = assessTranscriptBenchmarkReadiness(
      [candidate('provider-a'), candidate('provider-b')],
      ['provider-a', 'provider-b'],
    );

    expect(result).toEqual({ ready: true, reasons: [] });
  });

  it('fails closed when no providers are required', () => {
    const result = assessTranscriptBenchmarkReadiness([], []);

    expect(result).toEqual({
      ready: false,
      reasons: ['at least one required providerId is required'],
    });
  });

  it('fails closed when a required provider is missing', () => {
    const result = assessTranscriptBenchmarkReadiness(
      [candidate('provider-a')],
      ['provider-a', 'provider-b'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('missing benchmark candidate: provider-b');
  });

  it('rejects incomplete latency and operational evidence instead of allowing a premature winner', () => {
    const base = candidate();
    const reportWithoutLatency = summarizeTranscriptBenchmarkRun({
      providerId: 'provider-a',
      corpus,
      observations: [{ caseId: 'case-one', hypothesis: 'Explain Symfony' }],
    });

    const result = assessTranscriptBenchmarkReadiness(
      [
        {
          report: reportWithoutLatency,
          operational: {
            ...base.operational,
            endpointFinalizationP95Ms: null,
            reconnectSuccessRate: null,
            euProcessingAvailable: null,
          },
        },
      ],
      ['provider-a'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'provider-a: missing partial transcript latency samples',
      'provider-a: missing final transcript latency samples',
      'provider-a: missing local-channel latency samples',
      'provider-a: missing remote-channel latency samples',
      'provider-a: missing endpoint/finalization p95',
      'provider-a: missing reconnect success rate',
      'provider-a: EU processing availability not verified',
    ]));
  });

  it('rejects missing accuracy evidence', () => {
    const invalid = candidate();
    const result = assessTranscriptBenchmarkReadiness(
      [
        {
          ...invalid,
          report: {
            ...invalid.report,
            sampleCount: 0,
            accuracy: {
              ...invalid.report.accuracy,
              sampleCount: 0,
              referenceWordCount: 0,
              keyTermCount: 0,
              keyTermMatches: 0,
              keyTermAccuracy: null,
              samples: [],
            },
          },
        },
      ],
      ['provider-a'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'provider-a: missing accuracy samples',
      'provider-a: missing reference transcript words',
      'provider-a: missing technical-term accuracy samples',
    ]));
  });

  it('rejects internally inconsistent accuracy evidence', () => {
    const invalid = candidate();
    const result = assessTranscriptBenchmarkReadiness(
      [
        {
          ...invalid,
          report: {
            ...invalid.report,
            sampleCount: 2,
            accuracy: {
              ...invalid.report.accuracy,
              keyTermCount: 1,
              keyTermMatches: 2,
            },
          },
        },
      ],
      ['provider-a'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'provider-a: inconsistent accuracy sample counts',
      'provider-a: invalid technical-term counts',
    ]));
  });

  it('rejects duplicate candidates and out-of-range measured rates', () => {
    const invalid = candidate('provider-a');
    const result = assessTranscriptBenchmarkReadiness(
      [
        {
          ...invalid,
          operational: {
            ...invalid.operational,
            reconnectSuccessRate: 1.1,
            falseFinalizationRate: -0.1,
          },
        },
        candidate('provider-a'),
      ],
      ['provider-a'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'duplicate benchmark candidate: provider-a',
      'provider-a: missing reconnect success rate',
      'provider-a: missing false-finalization rate',
    ]));
  });

  it('rejects duplicate or non-canonical required provider ids', () => {
    const result = assessTranscriptBenchmarkReadiness(
      [candidate('provider-a')],
      ['provider-a', 'provider-a', ' provider-a '],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'duplicate required providerId: provider-a',
      'required providerId must be canonical:  provider-a ',
    ]));
  });

  it('rejects non-canonical candidate ids instead of silently normalizing them', () => {
    const base = candidate('provider-a');
    const invalid = {
      ...base,
      report: {
        ...base.report,
        providerId: ' provider-a ',
      },
    };
    const result = assessTranscriptBenchmarkReadiness([invalid], ['provider-a']);

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'candidate providerId must be canonical:  provider-a ',
      'missing benchmark candidate: provider-a',
    ]));
  });
});
