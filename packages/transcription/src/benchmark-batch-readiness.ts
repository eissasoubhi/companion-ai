import type { TranscriptBenchmarkBatchResult } from './benchmark-batch.js';
import { assessTranscriptBenchmarkEvidenceReadiness } from './benchmark-evidence-readiness.js';
import { measuredReportsFromTranscriptBenchmarkBatch } from './benchmark-measured-reports.js';
import type { TranscriptBenchmarkOperationalBundle } from './benchmark-operational-bundle.js';
import type { TranscriptBenchmarkSuiteResult } from './benchmark-suite.js';

export function assessTranscriptBenchmarkBatchReadiness(
  batch: TranscriptBenchmarkBatchResult,
  benchmarkRunId: string,
  operationalBundle: TranscriptBenchmarkOperationalBundle,
  requiredProviderIds: readonly string[],
): TranscriptBenchmarkSuiteResult {
  const reports = measuredReportsFromTranscriptBenchmarkBatch(batch, benchmarkRunId);
  return assessTranscriptBenchmarkEvidenceReadiness(reports, operationalBundle, requiredProviderIds);
}
