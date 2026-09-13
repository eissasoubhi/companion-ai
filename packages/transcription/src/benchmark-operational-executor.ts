import type { TranscriptOperationalScenarioExecutor } from './benchmark-operational-runner.js';

export type EndpointFinalizationExecutor = Pick<
  TranscriptOperationalScenarioExecutor,
  'providerId' | 'measureEndpointFinalization'
>;

export type ReconnectExecutor = Pick<
  TranscriptOperationalScenarioExecutor,
  'providerId' | 'measureReconnect'
>;

export type FalseFinalizationExecutor = Pick<
  TranscriptOperationalScenarioExecutor,
  'providerId' | 'measureFalseFinalization'
>;

export interface TranscriptOperationalScenarioExecutorParts {
  readonly endpointFinalization: EndpointFinalizationExecutor;
  readonly reconnect: ReconnectExecutor;
  readonly falseFinalization: FalseFinalizationExecutor;
}

function canonicalProviderId(value: string, field: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty canonical identifier`);
  }
  return value;
}

export function composeTranscriptOperationalScenarioExecutor(
  parts: TranscriptOperationalScenarioExecutorParts,
): TranscriptOperationalScenarioExecutor {
  const providerId = canonicalProviderId(
    parts.endpointFinalization.providerId,
    'endpointFinalization.providerId',
  );
  const reconnectProviderId = canonicalProviderId(parts.reconnect.providerId, 'reconnect.providerId');
  const falseFinalizationProviderId = canonicalProviderId(
    parts.falseFinalization.providerId,
    'falseFinalization.providerId',
  );

  if (reconnectProviderId !== providerId || falseFinalizationProviderId !== providerId) {
    throw new Error(
      `operational executor provider mismatch: expected ${providerId}, received reconnect=${reconnectProviderId}, falseFinalization=${falseFinalizationProviderId}`,
    );
  }

  return {
    providerId,
    measureEndpointFinalization: (scenarioId) =>
      parts.endpointFinalization.measureEndpointFinalization(scenarioId),
    measureReconnect: (scenarioId) => parts.reconnect.measureReconnect(scenarioId),
    measureFalseFinalization: (scenarioId) =>
      parts.falseFinalization.measureFalseFinalization(scenarioId),
  };
}
