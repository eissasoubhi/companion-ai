import { describe, expect, it } from 'vitest';

import type { TranscriptBenchmarkBatchResult } from './benchmark-batch.js';
import { measuredReportsFromTranscriptBenchmarkBatch } from './benchmark-measured-reports.js';

const fingerprint = 'a'.repeat(64);
const latencySummary = { count: 1, p50Ms: 1, p95Ms: 1, maxMs: 1, meanMs: 1 } as const;

function batch(overrides: Partial<TranscriptBenchmarkBatchResult> = {}): TranscriptBenchmarkBatchResult {
  const report = {
    providerId: 'deepgram',
    sampleCount: 1,
    accuracy: {
      sampleCount: 1,
      referenceWordCount: 1,
      wordErrorRate: 0,
      keyTermCount: 1,
      keyTermMatches: 1,
      keyTermAccuracy: 1,
      samples: [
        {
          id: 'case-1',
          wordErrorRate: 0,
          keyTermAccuracy: 1,
          keyTermCount: 1,
          keyTermMatches: 1,
          referenceWordCount: 1,
        },
      ],
    },
    latency: {
      all: latencySummary,
      partial: latencySummary,
      final: latencySummary,
      local: latencySummary,
      remote: latencySummary,
    },
  } as const;

  return {
    version: 2,
    corpusVersion: 'interview-v1',
    fixtureSetId: 'fixtures-v1',
    fixtureFingerprintSha256: fingerprint,
    caseIds: ['case-1'],
    providerIds: ['deepgram'],
    runs: [{ providerId: 'deepgram', observations: [], report }],
    ...overrides,
  };
}

describe('measuredReportsFromTranscriptBenchmarkBatch', () => {
  it('propagates exact batch provenance to every measured report', () => {
    const reports = measuredReportsFromTranscriptBenchmarkBatch(batch(), 'run-2026-09-14');

    expect(reports).toEqual([
      expect.objectContaining({
        benchmarkRunId: 'run-2026-09-14',
        corpusVersion: 'interview-v1',
        fixtureSetId: 'fixtures-v1',
        fixtureFingerprintSha256: fingerprint,
        report: expect.objectContaining({ providerId: 'deepgram' }),
      }),
    ]);
  });

  it('rejects malformed or non-canonical provenance', () => {
    expect(() => measuredReportsFromTranscriptBenchmarkBatch(batch(), ' run ')).toThrow(
      /benchmarkRunId must be canonical/,
    );
    expect(() =>
      measuredReportsFromTranscriptBenchmarkBatch(
        batch({ fixtureFingerprintSha256: fingerprint.toUpperCase() }),
        'run',
      ),
    ).toThrow(/canonical lowercase SHA-256/);
  });

  it('rejects provider lists that diverge from the actual runs', () => {
    expect(() =>
      measuredReportsFromTranscriptBenchmarkBatch(batch({ providerIds: ['assemblyai'] }), 'run'),
    ).toThrow(/not declared/);
    expect(() =>
      measuredReportsFromTranscriptBenchmarkBatch(
        batch({ providerIds: ['deepgram', 'assemblyai'] }),
        'run',
      ),
    ).toThrow(/providerIds must match run count/);
  });

  it('rejects a run whose embedded report belongs to another provider', () => {
    const original = batch();
    const run = original.runs[0]!;
    expect(() =>
      measuredReportsFromTranscriptBenchmarkBatch(
        batch({ runs: [{ ...run, report: { ...run.report, providerId: 'openai' } }] }),
        'run',
      ),
    ).toThrow(/run\/report provider mismatch/);
  });
});
