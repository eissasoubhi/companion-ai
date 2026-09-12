import { describe, expect, it } from 'vitest';

import { summarizeTranscriptBenchmarkRun } from './benchmark-runner.js';
import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';
import type { TranscriptLatencySample } from './types.js';

const corpus = [
  {
    id: 'en-one',
    locale: 'en',
    kind: 'technical',
    reference: 'Explain Symfony and React',
    keyTerms: ['Symfony', 'React'],
    tags: ['technical'],
  },
  {
    id: 'fr-two',
    locale: 'fr',
    kind: 'follow-up',
    reference: 'Et ensuite',
    keyTerms: [],
    tags: ['follow-up'],
  },
] as const satisfies readonly TranscriptBenchmarkCorpusCase[];

function latency(overrides: Partial<TranscriptLatencySample> = {}): TranscriptLatencySample {
  return {
    providerId: 'fake-stt',
    sessionId: 'benchmark',
    source: 'remote',
    segmentId: 'segment-1',
    isFinal: true,
    observedAtMs: 140,
    audioEndedAtMs: 100,
    lagMs: 40,
    ...overrides,
  };
}

describe('summarizeTranscriptBenchmarkRun', () => {
  it('combines corpus accuracy and latency summaries without provider-specific types', () => {
    const report = summarizeTranscriptBenchmarkRun({
      providerId: 'fake-stt',
      corpus,
      observations: [
        {
          caseId: 'en-one',
          hypothesis: 'Explain Symfony and React',
          latencySamples: [latency(), latency({ segmentId: 'segment-2', isFinal: false, lagMs: 20 })],
        },
        {
          caseId: 'fr-two',
          hypothesis: 'Et après',
          latencySamples: [latency({ segmentId: 'segment-3', lagMs: 60 })],
        },
      ],
    });

    expect(report.providerId).toBe('fake-stt');
    expect(report.sampleCount).toBe(2);
    expect(report.accuracy.keyTermAccuracy).toBe(1);
    expect(report.accuracy.wordErrorRate).toBeGreaterThan(0);
    expect(report.latency.all.count).toBe(3);
    expect(report.latency.all.p50Ms).toBe(40);
    expect(report.latency.final.p95Ms).toBe(60);
    expect(report.latency.remote.count).toBe(3);
    expect(report.latency.local.count).toBe(0);
  });

  it('rejects missing, duplicate and unknown observations', () => {
    expect(() =>
      summarizeTranscriptBenchmarkRun({
        providerId: 'fake-stt',
        corpus,
        observations: [{ caseId: 'en-one', hypothesis: 'ok' }],
      }),
    ).toThrow('missing benchmark observation: fr-two');

    expect(() =>
      summarizeTranscriptBenchmarkRun({
        providerId: 'fake-stt',
        corpus,
        observations: [
          { caseId: 'en-one', hypothesis: 'first' },
          { caseId: 'en-one', hypothesis: 'second' },
          { caseId: 'fr-two', hypothesis: 'third' },
        ],
      }),
    ).toThrow('duplicate benchmark observation: en-one');

    expect(() =>
      summarizeTranscriptBenchmarkRun({
        providerId: 'fake-stt',
        corpus,
        observations: [
          { caseId: 'en-one', hypothesis: 'first' },
          { caseId: 'fr-two', hypothesis: 'second' },
          { caseId: 'unknown', hypothesis: 'third' },
        ],
      }),
    ).toThrow('unknown benchmark case: unknown');
  });

  it('rejects an empty provider id and supports runs without latency samples', () => {
    expect(() =>
      summarizeTranscriptBenchmarkRun({
        providerId: '   ',
        corpus,
        observations: [
          { caseId: 'en-one', hypothesis: 'first' },
          { caseId: 'fr-two', hypothesis: 'second' },
        ],
      }),
    ).toThrow('providerId must not be empty');

    const report = summarizeTranscriptBenchmarkRun({
      providerId: 'offline-fixture',
      corpus,
      observations: [
        { caseId: 'en-one', hypothesis: 'Explain Symfony and React' },
        { caseId: 'fr-two', hypothesis: 'Et ensuite' },
      ],
    });

    expect(report.accuracy.wordErrorRate).toBe(0);
    expect(report.latency.all.count).toBe(0);
    expect(report.latency.all.p95Ms).toBeNull();
  });
});
