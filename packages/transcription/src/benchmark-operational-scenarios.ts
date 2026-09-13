import type { TranscriptBenchmarkOperationalEvidence } from './benchmark-readiness.js';

export type TranscriptOperationalScenarioObservation =
  | {
      readonly providerId: string;
      readonly scenarioId: string;
      readonly kind: 'endpoint-finalization';
      readonly delayMs: number;
    }
  | {
      readonly providerId: string;
      readonly scenarioId: string;
      readonly kind: 'reconnect';
      readonly succeeded: boolean;
      readonly recoveryMs: number | null;
    }
  | {
      readonly providerId: string;
      readonly scenarioId: string;
      readonly kind: 'false-finalization';
      readonly falselyFinalized: boolean;
    };

export interface TranscriptOperationalScenarioSummaryInput {
  readonly providerId: string;
  readonly observations: readonly TranscriptOperationalScenarioObservation[];
  readonly costPerLiveHourTwoChannelsUsd?: number | null | undefined;
  readonly euProcessingAvailable?: boolean | null | undefined;
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

function requireFiniteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }
  return value;
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? null;
}

export function summarizeTranscriptOperationalScenarios(
  input: TranscriptOperationalScenarioSummaryInput,
): TranscriptBenchmarkOperationalEvidence {
  const providerId = requireCanonicalId(input.providerId, 'providerId');
  const seenScenarioIds = new Set<string>();
  const endpointDelays: number[] = [];
  const reconnectRecoveryTimes: number[] = [];
  let reconnectAttempts = 0;
  let reconnectSuccesses = 0;
  let falseFinalizationScenarios = 0;
  let falseFinalizations = 0;

  for (const observation of input.observations) {
    const scenarioId = requireCanonicalId(observation.scenarioId, 'scenarioId');
    if (seenScenarioIds.has(scenarioId)) {
      throw new Error(`duplicate operational scenario: ${scenarioId}`);
    }
    seenScenarioIds.add(scenarioId);

    if (observation.providerId !== providerId) {
      throw new Error(
        `operational scenario provider mismatch for ${scenarioId}: expected ${providerId}, received ${observation.providerId}`,
      );
    }

    if (observation.kind === 'endpoint-finalization') {
      endpointDelays.push(requireFiniteNonNegative(observation.delayMs, `${scenarioId}.delayMs`));
      continue;
    }

    if (observation.kind === 'reconnect') {
      reconnectAttempts += 1;
      if (observation.succeeded) {
        if (observation.recoveryMs === null) {
          throw new Error(`${scenarioId}.recoveryMs is required for a successful reconnect`);
        }
        reconnectSuccesses += 1;
        reconnectRecoveryTimes.push(
          requireFiniteNonNegative(observation.recoveryMs, `${scenarioId}.recoveryMs`),
        );
      } else if (observation.recoveryMs !== null) {
        throw new Error(`${scenarioId}.recoveryMs must be null for a failed reconnect`);
      }
      continue;
    }

    falseFinalizationScenarios += 1;
    if (observation.falselyFinalized) {
      falseFinalizations += 1;
    }
  }

  const cost = input.costPerLiveHourTwoChannelsUsd ?? null;
  if (cost !== null) {
    requireFiniteNonNegative(cost, 'costPerLiveHourTwoChannelsUsd');
  }

  return {
    providerId,
    endpointFinalizationP95Ms: percentile95(endpointDelays),
    reconnectSuccessRate: reconnectAttempts === 0 ? null : reconnectSuccesses / reconnectAttempts,
    recoveryP95Ms: percentile95(reconnectRecoveryTimes),
    falseFinalizationRate:
      falseFinalizationScenarios === 0 ? null : falseFinalizations / falseFinalizationScenarios,
    costPerLiveHourTwoChannelsUsd: cost,
    euProcessingAvailable: input.euProcessingAvailable ?? null,
  };
}
