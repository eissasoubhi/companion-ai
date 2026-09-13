import { describe, expect, it } from 'vitest';

import { summarizeTranscriptOperationalScenarios } from './benchmark-operational-scenarios.js';

describe('summarizeTranscriptOperationalScenarios', () => {
  it('derives operational evidence from reproducible scenario observations', () => {
    const result = summarizeTranscriptOperationalScenarios({
      providerId: 'deepgram',
      observations: [
        { providerId: 'deepgram', scenarioId: 'endpoint-1', kind: 'endpoint-finalization', delayMs: 120 },
        { providerId: 'deepgram', scenarioId: 'endpoint-2', kind: 'endpoint-finalization', delayMs: 240 },
        { providerId: 'deepgram', scenarioId: 'reconnect-1', kind: 'reconnect', succeeded: true, recoveryMs: 400 },
        { providerId: 'deepgram', scenarioId: 'reconnect-2', kind: 'reconnect', succeeded: false, recoveryMs: null },
        { providerId: 'deepgram', scenarioId: 'pause-1', kind: 'false-finalization', falselyFinalized: false },
        { providerId: 'deepgram', scenarioId: 'pause-2', kind: 'false-finalization', falselyFinalized: true },
      ],
      costPerLiveHourTwoChannelsUsd: 0.52,
      euProcessingAvailable: true,
    });

    expect(result).toEqual({
      providerId: 'deepgram',
      endpointFinalizationP95Ms: 240,
      reconnectSuccessRate: 0.5,
      recoveryP95Ms: 400,
      falseFinalizationRate: 0.5,
      costPerLiveHourTwoChannelsUsd: 0.52,
      euProcessingAvailable: true,
    });
  });

  it('leaves metrics null when their scenario family has not been measured', () => {
    expect(
      summarizeTranscriptOperationalScenarios({
        providerId: 'openai',
        observations: [],
      }),
    ).toEqual({
      providerId: 'openai',
      endpointFinalizationP95Ms: null,
      reconnectSuccessRate: null,
      recoveryP95Ms: null,
      falseFinalizationRate: null,
      costPerLiveHourTwoChannelsUsd: null,
      euProcessingAvailable: null,
    });
  });

  it('rejects evidence attributed to another provider', () => {
    expect(() =>
      summarizeTranscriptOperationalScenarios({
        providerId: 'deepgram',
        observations: [
          {
            providerId: 'assemblyai',
            scenarioId: 'reconnect-1',
            kind: 'reconnect',
            succeeded: true,
            recoveryMs: 100,
          },
        ],
      }),
    ).toThrow(/provider mismatch/);
  });

  it('rejects duplicate scenario IDs across scenario kinds', () => {
    expect(() =>
      summarizeTranscriptOperationalScenarios({
        providerId: 'deepgram',
        observations: [
          { providerId: 'deepgram', scenarioId: 'same', kind: 'endpoint-finalization', delayMs: 100 },
          { providerId: 'deepgram', scenarioId: 'same', kind: 'false-finalization', falselyFinalized: false },
        ],
      }),
    ).toThrow('duplicate operational scenario: same');
  });

  it('requires recovery time only for successful reconnects', () => {
    expect(() =>
      summarizeTranscriptOperationalScenarios({
        providerId: 'deepgram',
        observations: [
          {
            providerId: 'deepgram',
            scenarioId: 'success-without-recovery',
            kind: 'reconnect',
            succeeded: true,
            recoveryMs: null,
          },
        ],
      }),
    ).toThrow(/recoveryMs is required/);

    expect(() =>
      summarizeTranscriptOperationalScenarios({
        providerId: 'deepgram',
        observations: [
          {
            providerId: 'deepgram',
            scenarioId: 'failed-with-recovery',
            kind: 'reconnect',
            succeeded: false,
            recoveryMs: 10,
          },
        ],
      }),
    ).toThrow(/recoveryMs must be null/);
  });

  it('rejects non-canonical IDs and invalid numeric evidence', () => {
    expect(() =>
      summarizeTranscriptOperationalScenarios({ providerId: ' deepgram', observations: [] }),
    ).toThrow(/providerId must be canonical/);

    expect(() =>
      summarizeTranscriptOperationalScenarios({
        providerId: 'deepgram',
        observations: [
          { providerId: 'deepgram', scenarioId: ' endpoint', kind: 'endpoint-finalization', delayMs: 1 },
        ],
      }),
    ).toThrow(/scenarioId must be canonical/);

    expect(() =>
      summarizeTranscriptOperationalScenarios({
        providerId: 'deepgram',
        observations: [
          { providerId: 'deepgram', scenarioId: 'endpoint', kind: 'endpoint-finalization', delayMs: Number.NaN },
        ],
      }),
    ).toThrow(/non-negative finite number/);
  });
});
