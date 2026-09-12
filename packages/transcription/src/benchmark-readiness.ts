import type { TranscriptBenchmarkRunReport } from './benchmark-runner.js';

export interface TranscriptBenchmarkOperationalEvidence {
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

function candidateReasons(candidate: TranscriptBenchmarkCandidate): string[] {
  const providerId = candidate.report.providerId;
  const reasons: string[] = [];

  if (candidate.report.latency.partial.count === 0) {
    reasons.push(`${providerId}: missing partial transcript latency samples`);
  }
  if (candidate.report.latency.final.count === 0) {
    reasons.push(`${providerId}: missing final transcript latency samples`);
  }
  if (candidate.report.latency.local.count === 0) {
    reasons.push(`${providerId}: missing local-channel latency samples`);
  }
  if (candidate.report.latency.remote.count === 0) {
    reasons.push(`${providerId}: missing remote-channel latency samples`);
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

  for (const candidate of candidates) {
    const providerId = candidate.report.providerId.trim();
    if (providerId.length === 0) {
      reasons.push('candidate providerId must not be empty');
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
