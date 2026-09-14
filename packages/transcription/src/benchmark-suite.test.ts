import { describe, expect, it } from 'vitest';

import { assessTranscriptBenchmarkSuite } from './benchmark-suite.js';
import { summarizeTranscriptBenchmarkRun } from './benchmark-runner.js';
import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';
import type { TranscriptLatencySample } from './types.js';

const corpus = [
  {
    id: 'case-one',
    locale: 'mixed',
    kind: 'technical',
    reference: 'Explain Symfony and React',
    keyTerms: ['Symfony', 'React'],
    tags: ['technical'],
  },
] as const satisfies readonly TranscriptBenchmarkCorpusCase[];

const fixtureFingerprintSha256 = 'a'.repeat(64);

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
    segmentId: `${providerId}-${source}-${isFinal ? 'final' : 'partial'}`,
    isFinal,
    observedAtMs: 100 + lagMs,
    audioEndedAtMs: 100,
    lagMs,
  };
}

function candidate(
  providerId: string,
  overrides: {
    corpusVersion?: string;
    fixtureSetId?: string;
    fixtureFingerprintSha256?: string;
  } = {},
) {
  return {
    corpusVersion: overrides.corpusVersion ?? 'v1',
    fixtureSetId: overrides.fixtureSetId ?? 'synthetic-interview-audio-v1',
    fixtureFingerprintSha256: overrides.fixtureFingerprintSha256 ?? fixtureFingerprintSha256,
    report: summarizeTranscriptBenchmarkRun({
      providerId,
      corpus,
      observations: [
        {
          caseId: 'case-one',
          hypothesis: 'Explain Symfony and React',
          latencySamples: [
            latency(providerId, 'local', false, 20),
            latency(providerId, 'local', true, 40),
            latency(providerId, 'remote', false, 30),
            latency(providerId, 'remote', true, 50),
          ],
        },
      ],
    }),
    operational: {
      providerId,
      endpointFinalizationP95Ms: 120,
      reconnectSuccessRate: 1,
      recoveryP95Ms: 300,
      falseFinalizationRate: 0,
      costPerLiveHourTwoChannelsUsd: 0.5,
      euProcessingAvailable: true,
    },
  } as const;
}

describe('assessTranscriptBenchmarkSuite', () => {
  it('is ready only when required providers use the same exact fixture bytes', () => {
    const result = assessTranscriptBenchmarkSuite(
      [candidate('deepgram'), candidate('assemblyai'), candidate('openai')],
      ['deepgram', 'assemblyai', 'openai'],
    );

    expect(result).toEqual({
      ready: true,
      reasons: [],
      readiness: { ready: true, reasons: [] },
      providerIds: ['deepgram', 'assemblyai', 'openai'],
      corpusVersion: 'v1',
      fixtureSetId: 'synthetic-interview-audio-v1',
      fixtureFingerprintSha256,
      sampleCount: 1,
    });
  });

  it('fails closed when providers are benchmarked against different fixture sets', () => {
    const result = assessTranscriptBenchmarkSuite(
      [candidate('deepgram'), candidate('assemblyai', { fixtureSetId: 'different-audio' })],
      ['deepgram', 'assemblyai'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain(
      'assemblyai: fixtureSetId different-audio does not match synthetic-interview-audio-v1',
    );
  });

  it('fails closed when fixture bytes differ despite matching fixture set ids', () => {
    const differentFingerprint = 'b'.repeat(64);
    const result = assessTranscriptBenchmarkSuite(
      [candidate('deepgram'), candidate('assemblyai', { fixtureFingerprintSha256: differentFingerprint })],
      ['deepgram', 'assemblyai'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain(
      `assemblyai: fixtureFingerprintSha256 ${differentFingerprint} does not match ${fixtureFingerprintSha256}`,
    );
  });

  it('rejects malformed or non-canonical fixture fingerprints', () => {
    for (const invalidFingerprint of ['A'.repeat(64), ` ${fixtureFingerprintSha256}`]) {
      const result = assessTranscriptBenchmarkSuite(
        [candidate('deepgram', { fixtureFingerprintSha256: invalidFingerprint })],
        ['deepgram'],
      );

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain(
        'deepgram: fixtureFingerprintSha256 must be a canonical lowercase SHA-256 digest',
      );
    }
  });

  it('fails closed when corpus versions differ', () => {
    const result = assessTranscriptBenchmarkSuite(
      [candidate('deepgram'), candidate('openai', { corpusVersion: 'v2' })],
      ['deepgram', 'openai'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('openai: corpusVersion v2 does not match v1');
  });

  it('rejects duplicate or empty required provider ids', () => {
    const result = assessTranscriptBenchmarkSuite(
      [candidate('deepgram')],
      ['deepgram', ' deepgram ', ''],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'duplicate required providerId: deepgram',
      'required providerId must not be empty',
    ]));
  });

  it('rejects empty benchmark identity metadata', () => {
    const result = assessTranscriptBenchmarkSuite(
      [candidate('deepgram', { corpusVersion: ' ', fixtureSetId: '' })],
      ['deepgram'],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'deepgram: corpusVersion must not be empty',
      'deepgram: fixtureSetId must not be empty',
    ]));
  });

  it('does not report readiness when no provider is required', () => {
    const result = assessTranscriptBenchmarkSuite([], []);

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('at least one required providerId is required');
  });
});
