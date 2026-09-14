import { describe, expect, it } from 'vitest';

import { assessTranscriptBenchmarkEvidenceReadiness } from './benchmark-evidence-readiness.js';
import { summarizeTranscriptBenchmarkRun } from './benchmark-runner.js';
import type { TranscriptBenchmarkOperationalBundle } from './benchmark-operational-bundle.js';
import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';

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

function measured(providerId: string, benchmarkRunId = 'run-1', corpusVersion = 'corpus-v1') {
  const report = summarizeTranscriptBenchmarkRun({
    providerId,
    corpus,
    observations: [
      {
        caseId: 'case-one',
        hypothesis: 'Explain Symfony',
        latencySamples: [
          { providerId, sessionId: 's', source: 'local', segmentId: 'lp', isFinal: false, observedAtMs: 120, audioEndedAtMs: 100, lagMs: 20 },
          { providerId, sessionId: 's', source: 'local', segmentId: 'lf', isFinal: true, observedAtMs: 140, audioEndedAtMs: 100, lagMs: 40 },
          { providerId, sessionId: 's', source: 'remote', segmentId: 'rp', isFinal: false, observedAtMs: 130, audioEndedAtMs: 100, lagMs: 30 },
          { providerId, sessionId: 's', source: 'remote', segmentId: 'rf', isFinal: true, observedAtMs: 150, audioEndedAtMs: 100, lagMs: 50 },
        ],
      },
    ],
  });

  return { benchmarkRunId, corpusVersion, fixtureSetId: 'accuracy-v1', report } as const;
}

function bundle(benchmarkRunId = 'run-1', corpusVersion = 'corpus-v1'): TranscriptBenchmarkOperationalBundle {
  const providerId = 'deepgram';
  return {
    schemaVersion: 1,
    fixtureSetId: 'operational-v1',
    corpusVersion,
    artifacts: [
      {
        schemaVersion: 1,
        benchmarkRunId,
        corpusVersion,
        providerId,
        measuredAt: '2026-09-14T02:00:00.000Z',
        evidence: {
          providerId,
          endpointFinalizationP95Ms: 120,
          reconnectSuccessRate: 1,
          recoveryP95Ms: 240,
          falseFinalizationRate: 0,
          costPerLiveHourTwoChannelsUsd: 0.5,
          euProcessingAvailable: true,
        },
      },
    ],
  };
}

describe('assessTranscriptBenchmarkEvidenceReadiness', () => {
  it('accepts evidence only when provider, run and corpus provenance align', () => {
    const result = assessTranscriptBenchmarkEvidenceReadiness(
      [measured('deepgram')],
      bundle(),
      ['deepgram'],
    );

    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('fails closed when operational evidence belongs to another benchmark run', () => {
    const result = assessTranscriptBenchmarkEvidenceReadiness(
      [measured('deepgram')],
      bundle('run-2'),
      ['deepgram'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'operational evidence benchmarkRunId mismatch: expected run-1, received run-2',
    ]));
  });

  it('fails closed when accuracy reports mix benchmark runs', () => {
    const result = assessTranscriptBenchmarkEvidenceReadiness(
      [measured('deepgram'), measured('openai', 'run-2')],
      bundle(),
      ['deepgram', 'openai'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('openai: benchmarkRunId run-2 does not match run-1');
  });

  it('fails closed when corpus versions differ', () => {
    const result = assessTranscriptBenchmarkEvidenceReadiness(
      [measured('deepgram', 'run-1', 'corpus-v2')],
      bundle(),
      ['deepgram'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain(
      'deepgram: operational corpusVersion corpus-v1 does not match corpus-v2',
    );
  });

  it('fails closed when a required provider has no operational artifact', () => {
    const result = assessTranscriptBenchmarkEvidenceReadiness(
      [measured('openai')],
      bundle(),
      ['openai'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'openai: missing operational benchmark evidence',
      'missing benchmark candidate: openai',
    ]));
  });
});
