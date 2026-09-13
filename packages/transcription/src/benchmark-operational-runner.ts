import {
  TRANSCRIPT_BENCHMARK_OPERATIONAL_EVIDENCE_SCHEMA_VERSION,
  type TranscriptBenchmarkOperationalEvidenceArtifact,
} from './benchmark-operational-evidence.js';
import {
  summarizeTranscriptOperationalScenarios,
  type TranscriptOperationalScenarioObservation,
} from './benchmark-operational-scenarios.js';
import type { TranscriptBenchmarkOperationalEvidence } from './benchmark-readiness.js';

export type TranscriptOperationalScenarioDefinition =
  | { readonly scenarioId: string; readonly kind: 'endpoint-finalization' }
  | { readonly scenarioId: string; readonly kind: 'reconnect' }
  | { readonly scenarioId: string; readonly kind: 'false-finalization' };

export interface TranscriptOperationalScenarioExecutor {
  readonly providerId: string;
  measureEndpointFinalization(
    scenarioId: string,
  ): Promise<{ readonly audioEndedAtMs: number; readonly finalTranscriptObservedAtMs: number }>;
  measureReconnect(
    scenarioId: string,
  ): Promise<{ readonly disconnectedAtMs: number; readonly recoveredAtMs: number | null }>;
  measureFalseFinalization(
    scenarioId: string,
  ): Promise<{ readonly falselyFinalized: boolean }>;
}

export interface TranscriptOperationalScenarioRunInput {
  readonly benchmarkRunId: string;
  readonly corpusVersion: string;
  readonly providerId: string;
  readonly scenarios: readonly TranscriptOperationalScenarioDefinition[];
  readonly executor: TranscriptOperationalScenarioExecutor;
  readonly costPerLiveHourTwoChannelsUsd?: number | null | undefined;
  readonly euProcessingAvailable?: boolean | null | undefined;
  readonly clock?: (() => number) | undefined;
}

export interface TranscriptOperationalScenarioRunResult {
  readonly observations: readonly TranscriptOperationalScenarioObservation[];
  readonly evidence: TranscriptBenchmarkOperationalEvidence;
  readonly artifact: TranscriptBenchmarkOperationalEvidenceArtifact;
}

function requireCanonicalId(value: string, field: string): string {
  if (value.length === 0) throw new Error(`${field} must not be empty`);
  if (value.trim() !== value) throw new Error(`${field} must be canonical`);
  return value;
}

function requireFiniteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }
  return value;
}

function elapsedMs(startedAtMs: number, endedAtMs: number, field: string): number {
  const start = requireFiniteNonNegative(startedAtMs, `${field}.startedAtMs`);
  const end = requireFiniteNonNegative(endedAtMs, `${field}.endedAtMs`);
  if (end < start) throw new Error(`${field} ended before it started`);
  return end - start;
}

function validateRun(input: TranscriptOperationalScenarioRunInput): void {
  requireCanonicalId(input.benchmarkRunId, 'benchmarkRunId');
  requireCanonicalId(input.corpusVersion, 'corpusVersion');
  const providerId = requireCanonicalId(input.providerId, 'providerId');
  const executorProviderId = requireCanonicalId(input.executor.providerId, 'executor.providerId');
  if (executorProviderId !== providerId) {
    throw new Error(
      `operational scenario executor provider mismatch: expected ${providerId}, received ${executorProviderId}`,
    );
  }

  const seen = new Set<string>();
  for (const scenario of input.scenarios) {
    const scenarioId = requireCanonicalId(scenario.scenarioId, 'scenarioId');
    if (seen.has(scenarioId)) throw new Error(`duplicate operational scenario: ${scenarioId}`);
    seen.add(scenarioId);
  }
}

export async function runTranscriptOperationalScenarios(
  input: TranscriptOperationalScenarioRunInput,
): Promise<TranscriptOperationalScenarioRunResult> {
  validateRun(input);
  const observations: TranscriptOperationalScenarioObservation[] = [];

  for (const scenario of input.scenarios) {
    if (scenario.kind === 'endpoint-finalization') {
      const measurement = await input.executor.measureEndpointFinalization(scenario.scenarioId);
      observations.push({
        providerId: input.providerId,
        scenarioId: scenario.scenarioId,
        kind: scenario.kind,
        delayMs: elapsedMs(
          measurement.audioEndedAtMs,
          measurement.finalTranscriptObservedAtMs,
          scenario.scenarioId,
        ),
      });
      continue;
    }

    if (scenario.kind === 'reconnect') {
      const measurement = await input.executor.measureReconnect(scenario.scenarioId);
      const recoveryMs =
        measurement.recoveredAtMs === null
          ? null
          : elapsedMs(
              measurement.disconnectedAtMs,
              measurement.recoveredAtMs,
              scenario.scenarioId,
            );
      observations.push({
        providerId: input.providerId,
        scenarioId: scenario.scenarioId,
        kind: scenario.kind,
        succeeded: recoveryMs !== null,
        recoveryMs,
      });
      continue;
    }

    const measurement = await input.executor.measureFalseFinalization(scenario.scenarioId);
    observations.push({
      providerId: input.providerId,
      scenarioId: scenario.scenarioId,
      kind: scenario.kind,
      falselyFinalized: measurement.falselyFinalized,
    });
  }

  const evidence = summarizeTranscriptOperationalScenarios({
    providerId: input.providerId,
    observations,
    costPerLiveHourTwoChannelsUsd: input.costPerLiveHourTwoChannelsUsd,
    euProcessingAvailable: input.euProcessingAvailable,
  });
  const measuredAtMs = (input.clock ?? Date.now)();
  requireFiniteNonNegative(measuredAtMs, 'clock');

  return {
    observations,
    evidence,
    artifact: {
      schemaVersion: TRANSCRIPT_BENCHMARK_OPERATIONAL_EVIDENCE_SCHEMA_VERSION,
      benchmarkRunId: input.benchmarkRunId,
      corpusVersion: input.corpusVersion,
      providerId: input.providerId,
      measuredAt: new Date(measuredAtMs).toISOString(),
      evidence,
    },
  };
}
