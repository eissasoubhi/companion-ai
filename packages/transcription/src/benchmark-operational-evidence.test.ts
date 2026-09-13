import { describe, expect, it } from 'vitest';
import {
  assertOperationalEvidenceMatchesBenchmark,
  parseTranscriptBenchmarkOperationalEvidenceArtifact,
} from './benchmark-operational-evidence.js';

const validArtifact = {
  schemaVersion: 1,
  benchmarkRunId: 'run-2026-09-13-01',
  corpusVersion: 'interview-corpus-v1',
  providerId: 'deepgram',
  measuredAt: '2026-09-13T09:30:00.000Z',
  evidence: {
    providerId: 'deepgram',
    endpointFinalizationP95Ms: 420,
    reconnectSuccessRate: 1,
    recoveryP95Ms: 730,
    falseFinalizationRate: 0.02,
    costPerLiveHourTwoChannelsUsd: 0.5,
    euProcessingAvailable: true,
  },
} as const;

describe('parseTranscriptBenchmarkOperationalEvidenceArtifact', () => {
  it('parses versioned provider-bound operational evidence', () => {
    expect(parseTranscriptBenchmarkOperationalEvidenceArtifact(validArtifact)).toEqual(validArtifact);
  });

  it('rejects evidence attributed to a different provider', () => {
    expect(() => parseTranscriptBenchmarkOperationalEvidenceArtifact({
      ...validArtifact,
      evidence: { ...validArtifact.evidence, providerId: 'openai' },
    })).toThrow('operational evidence provider mismatch');
  });

  it('rejects non-canonical benchmark provenance identifiers', () => {
    expect(() => parseTranscriptBenchmarkOperationalEvidenceArtifact({
      ...validArtifact,
      benchmarkRunId: ' run-2026-09-13-01 ',
    })).toThrow('benchmarkRunId must be canonical');
  });

  it('rejects unsupported schema versions', () => {
    expect(() => parseTranscriptBenchmarkOperationalEvidenceArtifact({
      ...validArtifact,
      schemaVersion: 2,
    })).toThrow('unsupported operational evidence schemaVersion');
  });

  it('rejects invalid operational rates', () => {
    expect(() => parseTranscriptBenchmarkOperationalEvidenceArtifact({
      ...validArtifact,
      evidence: { ...validArtifact.evidence, reconnectSuccessRate: 1.1 },
    })).toThrow('evidence.reconnectSuccessRate');
  });

  it('rejects timestamps that are parseable but not canonical ISO strings', () => {
    expect(() => parseTranscriptBenchmarkOperationalEvidenceArtifact({
      ...validArtifact,
      measuredAt: '2026-09-13T09:30:00Z',
    })).toThrow('measuredAt must be a canonical ISO timestamp');
  });
});

describe('assertOperationalEvidenceMatchesBenchmark', () => {
  it('accepts evidence from the exact benchmark run, corpus and provider', () => {
    const artifact = parseTranscriptBenchmarkOperationalEvidenceArtifact(validArtifact);

    expect(() => assertOperationalEvidenceMatchesBenchmark(artifact, {
      benchmarkRunId: validArtifact.benchmarkRunId,
      corpusVersion: validArtifact.corpusVersion,
      providerId: validArtifact.providerId,
    })).not.toThrow();
  });

  it('rejects evidence from another run', () => {
    const artifact = parseTranscriptBenchmarkOperationalEvidenceArtifact(validArtifact);

    expect(() => assertOperationalEvidenceMatchesBenchmark(artifact, {
      benchmarkRunId: 'run-2026-09-13-02',
      corpusVersion: validArtifact.corpusVersion,
      providerId: validArtifact.providerId,
    })).toThrow('operational evidence benchmarkRunId mismatch');
  });

  it('rejects evidence from another corpus version', () => {
    const artifact = parseTranscriptBenchmarkOperationalEvidenceArtifact(validArtifact);

    expect(() => assertOperationalEvidenceMatchesBenchmark(artifact, {
      benchmarkRunId: validArtifact.benchmarkRunId,
      corpusVersion: 'interview-corpus-v2',
      providerId: validArtifact.providerId,
    })).toThrow('operational evidence corpusVersion mismatch');
  });
});
