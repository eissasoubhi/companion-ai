import {
  parseTranscriptBenchmarkOperationalEvidenceArtifact,
  type TranscriptBenchmarkOperationalEvidenceArtifact,
} from './benchmark-operational-evidence.js';

export const TRANSCRIPT_BENCHMARK_OPERATIONAL_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface TranscriptBenchmarkOperationalBundle {
  readonly schemaVersion: typeof TRANSCRIPT_BENCHMARK_OPERATIONAL_BUNDLE_SCHEMA_VERSION;
  readonly fixtureSetId: string;
  readonly corpusVersion: string;
  readonly artifacts: readonly TranscriptBenchmarkOperationalEvidenceArtifact[];
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
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

export function parseTranscriptBenchmarkOperationalBundle(
  value: unknown,
): TranscriptBenchmarkOperationalBundle {
  const bundle = requireRecord(value, 'operational benchmark bundle');
  if (bundle.schemaVersion !== TRANSCRIPT_BENCHMARK_OPERATIONAL_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`unsupported operational benchmark bundle schemaVersion: ${String(bundle.schemaVersion)}`);
  }

  const fixtureSetId = requireCanonicalId(bundle.fixtureSetId, 'fixtureSetId');
  const corpusVersion = requireCanonicalId(bundle.corpusVersion, 'corpusVersion');
  if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length === 0) {
    throw new Error('operational benchmark bundle must contain at least one artifact');
  }

  const artifacts = bundle.artifacts.map(parseTranscriptBenchmarkOperationalEvidenceArtifact);
  const seenProviders = new Set<string>();
  let benchmarkRunId: string | undefined;

  for (const artifact of artifacts) {
    if (artifact.corpusVersion !== corpusVersion) {
      throw new Error(
        `operational benchmark bundle corpusVersion mismatch: bundle=${corpusVersion}, artifact=${artifact.corpusVersion}`,
      );
    }
    if (benchmarkRunId === undefined) {
      benchmarkRunId = artifact.benchmarkRunId;
    } else if (artifact.benchmarkRunId !== benchmarkRunId) {
      throw new Error(
        `operational benchmark bundle mixes benchmarkRunId values: expected ${benchmarkRunId}, received ${artifact.benchmarkRunId}`,
      );
    }
    if (seenProviders.has(artifact.providerId)) {
      throw new Error(`duplicate operational benchmark provider artifact: ${artifact.providerId}`);
    }
    seenProviders.add(artifact.providerId);
  }

  return {
    schemaVersion: TRANSCRIPT_BENCHMARK_OPERATIONAL_BUNDLE_SCHEMA_VERSION,
    fixtureSetId,
    corpusVersion,
    artifacts,
  };
}
