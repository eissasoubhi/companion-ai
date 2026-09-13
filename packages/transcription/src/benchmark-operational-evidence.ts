import type { TranscriptBenchmarkOperationalEvidence } from './benchmark-readiness.js';

export const TRANSCRIPT_BENCHMARK_OPERATIONAL_EVIDENCE_SCHEMA_VERSION = 1 as const;

export interface TranscriptBenchmarkOperationalEvidenceArtifact {
  readonly schemaVersion: typeof TRANSCRIPT_BENCHMARK_OPERATIONAL_EVIDENCE_SCHEMA_VERSION;
  readonly benchmarkRunId: string;
  readonly corpusVersion: string;
  readonly providerId: string;
  readonly measuredAt: string;
  readonly evidence: TranscriptBenchmarkOperationalEvidence;
}

function requireCanonicalId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value.trim() !== value) {
    throw new Error(`${field} must be canonical`);
  }
  return value;
}

function requireNullableFiniteNonNegative(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be null or a non-negative finite number`);
  }
  return value;
}

function requireNullableRate(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be null or a rate between 0 and 1`);
  }
  return value;
}

function requireNullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  throw new Error(`${field} must be null or a boolean`);
}

function requireIsoTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('measuredAt must be a non-empty ISO timestamp');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('measuredAt must be a canonical ISO timestamp');
  }
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseTranscriptBenchmarkOperationalEvidenceArtifact(
  value: unknown,
): TranscriptBenchmarkOperationalEvidenceArtifact {
  const artifact = requireRecord(value, 'operational evidence artifact');

  if (artifact.schemaVersion !== TRANSCRIPT_BENCHMARK_OPERATIONAL_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `unsupported operational evidence schemaVersion: ${String(artifact.schemaVersion)}`,
    );
  }

  const benchmarkRunId = requireCanonicalId(artifact.benchmarkRunId, 'benchmarkRunId');
  const corpusVersion = requireCanonicalId(artifact.corpusVersion, 'corpusVersion');
  const providerId = requireCanonicalId(artifact.providerId, 'providerId');
  const measuredAt = requireIsoTimestamp(artifact.measuredAt);
  const rawEvidence = requireRecord(artifact.evidence, 'evidence');
  const evidenceProviderId = requireCanonicalId(rawEvidence.providerId, 'evidence.providerId');

  if (evidenceProviderId !== providerId) {
    throw new Error(
      `operational evidence provider mismatch: artifact=${providerId}, evidence=${evidenceProviderId}`,
    );
  }

  return {
    schemaVersion: TRANSCRIPT_BENCHMARK_OPERATIONAL_EVIDENCE_SCHEMA_VERSION,
    benchmarkRunId,
    corpusVersion,
    providerId,
    measuredAt,
    evidence: {
      providerId: evidenceProviderId,
      endpointFinalizationP95Ms: requireNullableFiniteNonNegative(
        rawEvidence.endpointFinalizationP95Ms,
        'evidence.endpointFinalizationP95Ms',
      ),
      reconnectSuccessRate: requireNullableRate(
        rawEvidence.reconnectSuccessRate,
        'evidence.reconnectSuccessRate',
      ),
      recoveryP95Ms: requireNullableFiniteNonNegative(
        rawEvidence.recoveryP95Ms,
        'evidence.recoveryP95Ms',
      ),
      falseFinalizationRate: requireNullableRate(
        rawEvidence.falseFinalizationRate,
        'evidence.falseFinalizationRate',
      ),
      costPerLiveHourTwoChannelsUsd: requireNullableFiniteNonNegative(
        rawEvidence.costPerLiveHourTwoChannelsUsd,
        'evidence.costPerLiveHourTwoChannelsUsd',
      ),
      euProcessingAvailable: requireNullableBoolean(
        rawEvidence.euProcessingAvailable,
        'evidence.euProcessingAvailable',
      ),
    },
  };
}

export function assertOperationalEvidenceMatchesBenchmark(
  artifact: TranscriptBenchmarkOperationalEvidenceArtifact,
  expected: {
    readonly benchmarkRunId: string;
    readonly corpusVersion: string;
    readonly providerId: string;
  },
): void {
  if (artifact.benchmarkRunId !== expected.benchmarkRunId) {
    throw new Error(
      `operational evidence benchmarkRunId mismatch: expected ${expected.benchmarkRunId}, received ${artifact.benchmarkRunId}`,
    );
  }
  if (artifact.corpusVersion !== expected.corpusVersion) {
    throw new Error(
      `operational evidence corpusVersion mismatch: expected ${expected.corpusVersion}, received ${artifact.corpusVersion}`,
    );
  }
  if (artifact.providerId !== expected.providerId) {
    throw new Error(
      `operational evidence providerId mismatch: expected ${expected.providerId}, received ${artifact.providerId}`,
    );
  }
}
