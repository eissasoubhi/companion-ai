import { describe, expect, it } from 'vitest';

import type { TranscriptBenchmarkBatchResult } from './benchmark-batch.js';
import { assessTranscriptBenchmarkBatchReadiness } from './benchmark-batch-readiness.js';
import type { TranscriptBenchmarkOperationalBundle } from './benchmark-operational-bundle.js';

const fingerprint = 'a'.repeat(64);
const latencySummary = { count: 1, p50Ms: 20, p95Ms: 40, maxMs: 40, meanMs: 30 } as const;

function batch(): TranscriptBenchmarkBatchResult {
  const report = {
    providerId: 'deepgram',
    sampleCount: 1,
    accuracy: {
      sampleCount: 1,
      referenceWordCount: 2,
      wordErrorRate: 0,
      keyTermCount: 1,
      keyTermMatches: 1,
      keyTermAccuracy: 1,
      samples: [{ id: 'case-1', wordErrorRate: 0, keyTermAccuracy: 1, keyTermCount: 1, keyTermMatches: 1, referenceWordCount: 2 }],
    },
    latency: { all: latencySummary, partial: latencySummary, final: latencySummary, local: latencySummary, remote: latencySummary },
  } as const;

  return {
    version: 2,
    corpusVersion: 'corpus-v1',
    fixtureSetId: 'fixtures-v1',
    fixtureFingerprintSha256: fingerprint,
    caseIds: ['case-1'],
    providerIds: ['deepgram'],
    runs: [{ providerId: 'deepgram', observations: [], report }],
  };
}

function operationalBundle(): TranscriptBenchmarkOperationalBundle {
  return {
    schemaVersion: 1,
    fixtureSetId: 'operational-v1',
    corpusVersion: 'corpus-v1',
    artifacts: [{
      schemaVersion: 1,
      benchmarkRunId: 'run-1',
      corpusVersion: 'corpus-v1',
      providerId: 'deepgram',
      measuredAt: '2026-09-14T18:00:00.000Z',
      evidence: {
        providerId: 'deepgram',
        endpointFinalizationP95Ms: 120,
        reconnectSuccessRate: 1,
        recoveryP95Ms: 240,
        falseFinalizationRate: 0,
        costPerLiveHourTwoChannelsUsd: 0.5,
        euProcessingAvailable: true,
      },
    }],
  };
}

describe('assessTranscriptBenchmarkBatchReadiness', () => {
  it('feeds exact batch provenance into the final evidence gate', () => {
    const result = assessTranscriptBenchmarkBatchReadiness(batch(), 'run-1', operationalBundle(), ['deepgram']);
    expect(result.ready).toBe(true);
    expect(result.fixtureFingerprintSha256).toBe(fingerprint);
  });

  it('fails closed before readiness when batch provenance is malformed', () => {
    expect(() => assessTranscriptBenchmarkBatchReadiness(
      { ...batch(), fixtureFingerprintSha256: fingerprint.toUpperCase() },
      'run-1',
      operationalBundle(),
      ['deepgram'],
    )).toThrow(/canonical lowercase SHA-256/);
  });

  it('does not hide missing required providers behind the batch wrapper', () => {
    const result = assessTranscriptBenchmarkBatchReadiness(batch(), 'run-1', operationalBundle(), ['deepgram', 'openai']);
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('missing benchmark candidate: openai');
  });
});
