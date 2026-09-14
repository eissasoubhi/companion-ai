import type { TranscriptBenchmarkRunReport } from './benchmark-runner.js';

export interface TranscriptBenchmarkOperationalEvidence {
  readonly providerId: string;
  readonly endpointFinalizationP95Ms: number | null;
  readonly reconnectSuccessRate: number | null;
  readonly recoveryP95Ms: number | null;
  readonly falseFinalizationRate: number | null;
  readonly costPerLiveHourTwoChannelsUsd: number | null;
  readonly euProcessingAvailable: boolean | null;
}

export interface TranscriptBenchmarkCandidate {
  readonly report: TranscriptBenchmarkRunReport;
  readonly operational: TranscriptBenchmarkOperationalEvidence;
}

export interface TranscriptBenchmarkReadiness {
  readonly ready: boolean;
  readonly reasons: readonly string[];
}

function isNonNegativeFinite(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function isRate(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function isValidLatencySummary(
  summary: TranscriptBenchmarkRunReport['latency']['partial'],
): boolean {
  if (!isNonNegativeInteger(summary.count)) return false;

  const values = [summary.p50Ms, summary.p95Ms, summary.maxMs, summary.meanMs] as const;
  if (summary.count === 0) return values.every((value) => value === null);
  if (!values.every(isNonNegativeFinite)) return false;

  const p50 = summary.p50Ms!;
  const p95 = summary.p95Ms!;
  const max = summary.maxMs!;
  const mean = summary.meanMs!;
  return p50 <= p95 && p95 <= max && mean <= max;
}

function accuracySampleReasons(
  providerId: string,
  accuracy: TranscriptBenchmarkRunReport['accuracy'],
): string[] {
  const reasons: string[] = [];
  const ids = new Set<string>();
  let referenceWordCount = 0;
  let keyTermCount = 0;
  let keyTermMatches = 0;
  let weightedErrors = 0;

  for (const sample of accuracy.samples) {
    const id = sample.id.trim();
    if (id.length === 0 || id !== sample.id) {
      reasons.push(`${providerId}: invalid accuracy sample id`);
    } else if (ids.has(id)) {
      reasons.push(`${providerId}: duplicate accuracy sample id: ${id}`);
    } else {
      ids.add(id);
    }

    if (!isNonNegativeInteger(sample.referenceWordCount) || sample.referenceWordCount === 0) {
      reasons.push(`${providerId}: invalid accuracy sample reference word count: ${sample.id}`);
    }
    if (!Number.isFinite(sample.wordErrorRate) || sample.wordErrorRate < 0) {
      reasons.push(`${providerId}: invalid accuracy sample word error rate: ${sample.id}`);
    }
    if (
      !isNonNegativeInteger(sample.keyTermCount)
      || !isNonNegativeInteger(sample.keyTermMatches)
      || sample.keyTermMatches > sample.keyTermCount
    ) {
      reasons.push(`${providerId}: invalid accuracy sample technical-term counts: ${sample.id}`);
    }
    if (sample.keyTermCount === 0) {
      if (sample.keyTermAccuracy !== null) {
        reasons.push(`${providerId}: invalid accuracy sample technical-term accuracy: ${sample.id}`);
      }
    } else if (!isRate(sample.keyTermAccuracy)) {
      reasons.push(`${providerId}: invalid accuracy sample technical-term accuracy: ${sample.id}`);
    } else if (!nearlyEqual(sample.keyTermAccuracy!, sample.keyTermMatches / sample.keyTermCount)) {
      reasons.push(`${providerId}: inconsistent accuracy sample technical-term accuracy: ${sample.id}`);
    }

    if (isNonNegativeInteger(sample.referenceWordCount)) {
      referenceWordCount += sample.referenceWordCount;
      if (Number.isFinite(sample.wordErrorRate) && sample.wordErrorRate >= 0) {
        weightedErrors += sample.wordErrorRate * sample.referenceWordCount;
      }
    }
    if (isNonNegativeInteger(sample.keyTermCount)) keyTermCount += sample.keyTermCount;
    if (isNonNegativeInteger(sample.keyTermMatches)) keyTermMatches += sample.keyTermMatches;
  }

  if (
    referenceWordCount !== accuracy.referenceWordCount
    || keyTermCount !== accuracy.keyTermCount
    || keyTermMatches !== accuracy.keyTermMatches
  ) {
    reasons.push(`${providerId}: aggregate accuracy counts do not match sample evidence`);
  }

  if (referenceWordCount > 0 && Number.isFinite(accuracy.wordErrorRate)) {
    const expectedWordErrorRate = weightedErrors / referenceWordCount;
    if (!nearlyEqual(expectedWordErrorRate, accuracy.wordErrorRate)) {
      reasons.push(`${providerId}: aggregate word error rate does not match sample evidence`);
    }
  }

  const expectedKeyTermAccuracy = keyTermCount === 0 ? null : keyTermMatches / keyTermCount;
  if (
    expectedKeyTermAccuracy === null
      ? accuracy.keyTermAccuracy !== null
      : accuracy.keyTermAccuracy === null || !nearlyEqual(expectedKeyTermAccuracy, accuracy.keyTermAccuracy)
  ) {
    reasons.push(`${providerId}: aggregate technical-term accuracy does not match sample evidence`);
  }

  return reasons;
}

function candidateReasons(candidate: TranscriptBenchmarkCandidate): string[] {
  const providerId = candidate.report.providerId;
  const reasons: string[] = [];
  const accuracy = candidate.report.accuracy;
  const latency = candidate.report.latency;
  const operationalProviderId = candidate.operational.providerId.trim();

  if (operationalProviderId.length === 0) {
    reasons.push(`${providerId}: operational evidence providerId must not be empty`);
  } else if (operationalProviderId !== candidate.operational.providerId) {
    reasons.push(`${providerId}: operational evidence providerId must be canonical: ${candidate.operational.providerId}`);
  } else if (operationalProviderId !== providerId) {
    reasons.push(
      `${providerId}: operational evidence provider mismatch: received ${candidate.operational.providerId}`,
    );
  }

  if (candidate.report.sampleCount === 0 || accuracy.sampleCount === 0) {
    reasons.push(`${providerId}: missing accuracy samples`);
  }
  if (
    !isNonNegativeInteger(candidate.report.sampleCount)
    || !isNonNegativeInteger(accuracy.sampleCount)
    || candidate.report.sampleCount !== accuracy.sampleCount
    || accuracy.samples.length !== accuracy.sampleCount
  ) {
    reasons.push(`${providerId}: inconsistent accuracy sample counts`);
  }
  if (!isNonNegativeInteger(accuracy.referenceWordCount) || accuracy.referenceWordCount === 0) {
    reasons.push(`${providerId}: missing reference transcript words`);
  }
  if (!Number.isFinite(accuracy.wordErrorRate) || accuracy.wordErrorRate < 0) {
    reasons.push(`${providerId}: invalid word error rate`);
  }
  if (accuracy.keyTermCount === 0 || accuracy.keyTermAccuracy === null) {
    reasons.push(`${providerId}: missing technical-term accuracy samples`);
  } else if (!isRate(accuracy.keyTermAccuracy)) {
    reasons.push(`${providerId}: invalid technical-term accuracy`);
  }
  if (
    !isNonNegativeInteger(accuracy.keyTermCount)
    || !isNonNegativeInteger(accuracy.keyTermMatches)
    || accuracy.keyTermMatches > accuracy.keyTermCount
  ) {
    reasons.push(`${providerId}: invalid technical-term counts`);
  }
  reasons.push(...accuracySampleReasons(providerId, accuracy));

  if (latency.partial.count === 0) {
    reasons.push(`${providerId}: missing partial transcript latency samples`);
  }
  if (latency.final.count === 0) {
    reasons.push(`${providerId}: missing final transcript latency samples`);
  }
  if (latency.local.count === 0) {
    reasons.push(`${providerId}: missing local-channel latency samples`);
  }
  if (latency.remote.count === 0) {
    reasons.push(`${providerId}: missing remote-channel latency samples`);
  }

  for (const [label, summary] of [
    ['all', latency.all],
    ['partial', latency.partial],
    ['final', latency.final],
    ['local', latency.local],
    ['remote', latency.remote],
  ] as const) {
    if (!isValidLatencySummary(summary)) {
      reasons.push(`${providerId}: invalid ${label} transcript latency summary`);
    }
  }

  if (
    latency.all.count !== latency.partial.count + latency.final.count
    || latency.all.count !== latency.local.count + latency.remote.count
  ) {
    reasons.push(`${providerId}: inconsistent transcript latency sample counts`);
  }

  if (!isNonNegativeFinite(candidate.operational.endpointFinalizationP95Ms)) {
    reasons.push(`${providerId}: missing endpoint/finalization p95`);
  }
  if (!isRate(candidate.operational.reconnectSuccessRate)) {
    reasons.push(`${providerId}: missing reconnect success rate`);
  }
  if (!isNonNegativeFinite(candidate.operational.recoveryP95Ms)) {
    reasons.push(`${providerId}: missing recovery p95`);
  }
  if (!isRate(candidate.operational.falseFinalizationRate)) {
    reasons.push(`${providerId}: missing false-finalization rate`);
  }
  if (!isNonNegativeFinite(candidate.operational.costPerLiveHourTwoChannelsUsd)) {
    reasons.push(`${providerId}: missing two-channel hourly cost`);
  }
  if (candidate.operational.euProcessingAvailable === null) {
    reasons.push(`${providerId}: EU processing availability not verified`);
  }

  return reasons;
}

export function assessTranscriptBenchmarkReadiness(
  candidates: readonly TranscriptBenchmarkCandidate[],
  requiredProviderIds: readonly string[],
): TranscriptBenchmarkReadiness {
  const reasons: string[] = [];
  const candidatesById = new Map<string, TranscriptBenchmarkCandidate>();
  const requiredIds = new Set<string>();

  if (requiredProviderIds.length === 0) {
    reasons.push('at least one required providerId is required');
  }

  for (const candidate of candidates) {
    const providerId = candidate.report.providerId.trim();
    if (providerId.length === 0) {
      reasons.push('candidate providerId must not be empty');
      continue;
    }
    if (providerId !== candidate.report.providerId) {
      reasons.push(`candidate providerId must be canonical: ${candidate.report.providerId}`);
      continue;
    }
    if (candidatesById.has(providerId)) {
      reasons.push(`duplicate benchmark candidate: ${providerId}`);
      continue;
    }
    candidatesById.set(providerId, candidate);
  }

  for (const providerId of requiredProviderIds) {
    const normalized = providerId.trim();
    if (normalized.length === 0) {
      reasons.push('required providerId must not be empty');
      continue;
    }
    if (normalized !== providerId) {
      reasons.push(`required providerId must be canonical: ${providerId}`);
      continue;
    }
    if (requiredIds.has(normalized)) {
      reasons.push(`duplicate required providerId: ${normalized}`);
      continue;
    }
    requiredIds.add(normalized);

    const candidate = candidatesById.get(normalized);
    if (!candidate) {
      reasons.push(`missing benchmark candidate: ${normalized}`);
      continue;
    }
    reasons.push(...candidateReasons(candidate));
  }

  return {
    ready: reasons.length === 0,
    reasons,
  };
}
