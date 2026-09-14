import { describe, expect, it } from 'vitest';

import { parseTranscriptBenchmarkOperationalBundle } from './benchmark-operational-bundle.js';

function artifact(providerId: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    benchmarkRunId: 'run-1',
    corpusVersion: 'corpus-v1',
    providerId,
    measuredAt: '2026-09-14T01:00:00.000Z',
    evidence: {
      providerId,
      endpointFinalizationP95Ms: 120,
      reconnectSuccessRate: 1,
      recoveryP95Ms: 240,
      falseFinalizationRate: 0,
      costPerLiveHourTwoChannelsUsd: null,
      euProcessingAvailable: null,
    },
    ...overrides,
  };
}

function bundle(artifacts: readonly unknown[]) {
  return {
    schemaVersion: 1,
    fixtureSetId: 'operational-v1',
    corpusVersion: 'corpus-v1',
    artifacts,
  };
}

describe('parseTranscriptBenchmarkOperationalBundle', () => {
  it('accepts one coherent artifact per provider', () => {
    const parsed = parseTranscriptBenchmarkOperationalBundle(
      bundle([artifact('deepgram'), artifact('assemblyai'), artifact('openai')]),
    );

    expect(parsed.fixtureSetId).toBe('operational-v1');
    expect(parsed.artifacts.map(({ providerId }) => providerId)).toEqual([
      'deepgram',
      'assemblyai',
      'openai',
    ]);
  });

  it('rejects an empty artifact set', () => {
    expect(() => parseTranscriptBenchmarkOperationalBundle(bundle([]))).toThrow(
      'must contain at least one artifact',
    );
  });

  it('rejects duplicate provider artifacts', () => {
    expect(() =>
      parseTranscriptBenchmarkOperationalBundle(bundle([artifact('deepgram'), artifact('deepgram')])),
    ).toThrow('duplicate operational benchmark provider artifact: deepgram');
  });

  it('rejects mixed benchmark runs', () => {
    expect(() =>
      parseTranscriptBenchmarkOperationalBundle(
        bundle([artifact('deepgram'), artifact('assemblyai', { benchmarkRunId: 'run-2' })]),
      ),
    ).toThrow('mixes benchmarkRunId values');
  });

  it('rejects artifact corpus versions that do not match the bundle', () => {
    expect(() =>
      parseTranscriptBenchmarkOperationalBundle(
        bundle([artifact('deepgram', { corpusVersion: 'corpus-v2' })]),
      ),
    ).toThrow('corpusVersion mismatch');
  });

  it('rejects non-canonical fixture metadata before readiness consumption', () => {
    expect(() =>
      parseTranscriptBenchmarkOperationalBundle({
        ...bundle([artifact('deepgram')]),
        fixtureSetId: ' operational-v1 ',
      }),
    ).toThrow('fixtureSetId must be canonical');
  });
});
