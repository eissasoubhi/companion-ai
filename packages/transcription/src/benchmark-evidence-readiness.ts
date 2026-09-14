import type { TranscriptBenchmarkOperationalBundle } from './benchmark-operational-bundle.js';
import {
  assertOperationalEvidenceMatchesBenchmark,
  type TranscriptBenchmarkOperationalEvidenceArtifact,
} from './benchmark-operational-evidence.js';
import {
  assessTranscriptBenchmarkSuite,
  type TranscriptBenchmarkSuiteCandidate,
  type TranscriptBenchmarkSuiteResult,
} from './benchmark-suite.js';
import type { TranscriptBenchmarkRunReport } from './benchmark-runner.js';

export interface TranscriptBenchmarkMeasuredReport {
  readonly benchmarkRunId: string;
  readonly corpusVersion: string;
  readonly fixtureSetId: string;
  readonly report: TranscriptBenchmarkRunReport;
}

function requireCanonicalId(value: string, field: string): string {
  if (value.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  if (value.trim() !== value) {
    throw new Error(`${field} must be canonical`);
  }
  return value;
}

function artifactsByProvider(
  bundle: TranscriptBenchmarkOperationalBundle,
): Map<string, TranscriptBenchmarkOperationalEvidenceArtifact> {
  return new Map(bundle.artifacts.map((artifact) => [artifact.providerId, artifact]));
}

export function assessTranscriptBenchmarkEvidenceReadiness(
  reports: readonly TranscriptBenchmarkMeasuredReport[],
  operationalBundle: TranscriptBenchmarkOperationalBundle,
  requiredProviderIds: readonly string[],
): TranscriptBenchmarkSuiteResult {
  if (reports.length === 0) {
    return assessTranscriptBenchmarkSuite([], requiredProviderIds);
  }

  const runId = requireCanonicalId(reports[0]!.benchmarkRunId, 'benchmarkRunId');
  const evidenceByProvider = artifactsByProvider(operationalBundle);
  const candidates: TranscriptBenchmarkSuiteCandidate[] = [];
  const provenanceErrors: string[] = [];

  for (const measured of reports) {
    const providerId = measured.report.providerId;
    const measuredRunId = requireCanonicalId(measured.benchmarkRunId, `${providerId}: benchmarkRunId`);
    const corpusVersion = requireCanonicalId(measured.corpusVersion, `${providerId}: corpusVersion`);
    const fixtureSetId = requireCanonicalId(measured.fixtureSetId, `${providerId}: fixtureSetId`);

    if (measuredRunId !== runId) {
      provenanceErrors.push(`${providerId}: benchmarkRunId ${measuredRunId} does not match ${runId}`);
      continue;
    }
    if (corpusVersion !== operationalBundle.corpusVersion) {
      provenanceErrors.push(
        `${providerId}: operational corpusVersion ${operationalBundle.corpusVersion} does not match ${corpusVersion}`,
      );
      continue;
    }

    const artifact = evidenceByProvider.get(providerId);
    if (!artifact) {
      provenanceErrors.push(`${providerId}: missing operational benchmark evidence`);
      continue;
    }

    try {
      assertOperationalEvidenceMatchesBenchmark(artifact, {
        benchmarkRunId: runId,
        corpusVersion,
        providerId,
      });
    } catch (error) {
      provenanceErrors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    candidates.push({
      report: measured.report,
      operational: artifact.evidence,
      corpusVersion,
      fixtureSetId,
    });
  }

  const suite = assessTranscriptBenchmarkSuite(candidates, requiredProviderIds);
  if (provenanceErrors.length === 0) {
    return suite;
  }

  return {
    ...suite,
    ready: false,
    reasons: [...provenanceErrors, ...suite.reasons],
  };
}
