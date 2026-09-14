import {
  assessTranscriptBenchmarkReadiness,
  type TranscriptBenchmarkCandidate,
  type TranscriptBenchmarkReadiness,
} from './benchmark-readiness.js';

export interface TranscriptBenchmarkSuiteCandidate extends TranscriptBenchmarkCandidate {
  readonly corpusVersion: string;
  readonly fixtureSetId: string;
  readonly fixtureFingerprintSha256: string;
}

export interface TranscriptBenchmarkSuiteResult {
  readonly ready: boolean;
  readonly reasons: readonly string[];
  readonly readiness: TranscriptBenchmarkReadiness;
  readonly providerIds: readonly string[];
  readonly corpusVersion: string | null;
  readonly fixtureSetId: string | null;
  readonly fixtureFingerprintSha256: string | null;
  readonly sampleCount: number | null;
}

function normalizedNonEmpty(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizedSha256(value: string): string | null {
  const normalized = value.trim();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function assessTranscriptBenchmarkSuite(
  candidates: readonly TranscriptBenchmarkSuiteCandidate[],
  requiredProviderIds: readonly string[],
): TranscriptBenchmarkSuiteResult {
  const reasons: string[] = [];
  const normalizedRequiredProviderIds: string[] = [];
  const requiredProviderIdsSeen = new Set<string>();

  for (const providerId of requiredProviderIds) {
    const normalized = normalizedNonEmpty(providerId);
    if (!normalized) {
      reasons.push('required providerId must not be empty');
      continue;
    }
    if (requiredProviderIdsSeen.has(normalized)) {
      reasons.push(`duplicate required providerId: ${normalized}`);
      continue;
    }
    requiredProviderIdsSeen.add(normalized);
    normalizedRequiredProviderIds.push(normalized);
  }

  if (normalizedRequiredProviderIds.length === 0) {
    reasons.push('at least one required providerId is required');
  }

  const readiness = assessTranscriptBenchmarkReadiness(candidates, normalizedRequiredProviderIds);
  reasons.push(...readiness.reasons);

  const requiredCandidates = candidates.filter((candidate) =>
    requiredProviderIdsSeen.has(candidate.report.providerId.trim()),
  );

  let corpusVersion: string | null = null;
  let fixtureSetId: string | null = null;
  let fixtureFingerprintSha256: string | null = null;
  let sampleCount: number | null = null;

  for (const candidate of requiredCandidates) {
    const providerId = candidate.report.providerId.trim() || '<unknown>';
    const candidateCorpusVersion = normalizedNonEmpty(candidate.corpusVersion);
    const candidateFixtureSetId = normalizedNonEmpty(candidate.fixtureSetId);
    const candidateFixtureFingerprintSha256 = normalizedSha256(candidate.fixtureFingerprintSha256);

    if (!candidateCorpusVersion) {
      reasons.push(`${providerId}: corpusVersion must not be empty`);
    } else if (corpusVersion === null) {
      corpusVersion = candidateCorpusVersion;
    } else if (candidateCorpusVersion !== corpusVersion) {
      reasons.push(
        `${providerId}: corpusVersion ${candidateCorpusVersion} does not match ${corpusVersion}`,
      );
    }

    if (!candidateFixtureSetId) {
      reasons.push(`${providerId}: fixtureSetId must not be empty`);
    } else if (fixtureSetId === null) {
      fixtureSetId = candidateFixtureSetId;
    } else if (candidateFixtureSetId !== fixtureSetId) {
      reasons.push(
        `${providerId}: fixtureSetId ${candidateFixtureSetId} does not match ${fixtureSetId}`,
      );
    }

    if (!candidateFixtureFingerprintSha256) {
      reasons.push(`${providerId}: fixtureFingerprintSha256 must be a lowercase SHA-256 digest`);
    } else if (fixtureFingerprintSha256 === null) {
      fixtureFingerprintSha256 = candidateFixtureFingerprintSha256;
    } else if (candidateFixtureFingerprintSha256 !== fixtureFingerprintSha256) {
      reasons.push(
        `${providerId}: fixtureFingerprintSha256 ${candidateFixtureFingerprintSha256} does not match ${fixtureFingerprintSha256}`,
      );
    }

    if (sampleCount === null) {
      sampleCount = candidate.report.sampleCount;
    } else if (candidate.report.sampleCount !== sampleCount) {
      reasons.push(
        `${providerId}: sampleCount ${candidate.report.sampleCount} does not match ${sampleCount}`,
      );
    }
  }

  return {
    ready: reasons.length === 0,
    reasons,
    readiness,
    providerIds: normalizedRequiredProviderIds,
    corpusVersion,
    fixtureSetId,
    fixtureFingerprintSha256,
    sampleCount,
  };
}
