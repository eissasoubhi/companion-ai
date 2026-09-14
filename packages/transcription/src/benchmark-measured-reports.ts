import type { TranscriptBenchmarkBatchResult } from './benchmark-batch.js';
import type { TranscriptBenchmarkMeasuredReport } from './benchmark-evidence-readiness.js';

function requireCanonicalId(value: string, field: string): string {
  if (value.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  if (value.trim() !== value) {
    throw new Error(`${field} must be canonical`);
  }
  return value;
}

export function measuredReportsFromTranscriptBenchmarkBatch(
  batch: TranscriptBenchmarkBatchResult,
  benchmarkRunId: string,
): readonly TranscriptBenchmarkMeasuredReport[] {
  const runId = requireCanonicalId(benchmarkRunId, 'benchmarkRunId');
  const corpusVersion = requireCanonicalId(batch.corpusVersion, 'corpusVersion');
  const fixtureSetId = requireCanonicalId(batch.fixtureSetId, 'fixtureSetId');

  if (!/^[a-f0-9]{64}$/.test(batch.fixtureFingerprintSha256)) {
    throw new Error('fixtureFingerprintSha256 must be a canonical lowercase SHA-256');
  }
  if (batch.runs.length === 0) {
    throw new Error('benchmark batch must contain at least one provider run');
  }
  if (batch.providerIds.length !== batch.runs.length) {
    throw new Error('benchmark batch providerIds must match run count');
  }

  const expectedProviders = new Set<string>();
  for (const providerId of batch.providerIds) {
    requireCanonicalId(providerId, 'providerId');
    if (expectedProviders.has(providerId)) {
      throw new Error(`duplicate benchmark providerId: ${providerId}`);
    }
    expectedProviders.add(providerId);
  }

  const seenProviders = new Set<string>();
  const reports = batch.runs.map((run) => {
    const providerId = requireCanonicalId(run.providerId, 'run providerId');
    if (run.report.providerId !== providerId) {
      throw new Error(
        `benchmark run/report provider mismatch: ${providerId} != ${run.report.providerId}`,
      );
    }
    if (!expectedProviders.has(providerId)) {
      throw new Error(`benchmark run provider is not declared in providerIds: ${providerId}`);
    }
    if (seenProviders.has(providerId)) {
      throw new Error(`duplicate benchmark run provider: ${providerId}`);
    }
    seenProviders.add(providerId);

    return {
      benchmarkRunId: runId,
      corpusVersion,
      fixtureSetId,
      fixtureFingerprintSha256: batch.fixtureFingerprintSha256,
      report: run.report,
    } satisfies TranscriptBenchmarkMeasuredReport;
  });

  if (seenProviders.size !== expectedProviders.size) {
    const missing = [...expectedProviders].filter((providerId) => !seenProviders.has(providerId));
    throw new Error(`benchmark batch is missing provider runs: ${missing.join(', ')}`);
  }

  return reports;
}
