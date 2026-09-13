import { describe, expect, it, vi } from 'vitest';

import {
  runTranscriptOperationalScenarios,
  type TranscriptOperationalScenarioExecutor,
} from './benchmark-operational-runner.js';

function createExecutor(): TranscriptOperationalScenarioExecutor {
  return {
    providerId: 'deepgram',
    measureEndpointFinalization: vi.fn(async () => ({
      audioEndedAtMs: 1_000,
      finalTranscriptObservedAtMs: 1_180,
    })),
    measureReconnect: vi.fn(async () => ({
      disconnectedAtMs: 2_000,
      recoveredAtMs: 2_450,
    })),
    measureFalseFinalization: vi.fn(async () => ({ falselyFinalized: false })),
  };
}

describe('runTranscriptOperationalScenarios', () => {
  it('executes scenarios sequentially and returns versioned evidence', async () => {
    const order: string[] = [];
    const executor: TranscriptOperationalScenarioExecutor = {
      providerId: 'deepgram',
      measureEndpointFinalization: async (scenarioId) => {
        order.push(scenarioId);
        return { audioEndedAtMs: 1_000, finalTranscriptObservedAtMs: 1_180 };
      },
      measureReconnect: async (scenarioId) => {
        order.push(scenarioId);
        return { disconnectedAtMs: 2_000, recoveredAtMs: 2_450 };
      },
      measureFalseFinalization: async (scenarioId) => {
        order.push(scenarioId);
        return { falselyFinalized: false };
      },
    };

    const result = await runTranscriptOperationalScenarios({
      benchmarkRunId: 'run-2026-09-13',
      corpusVersion: 'corpus-v1',
      providerId: 'deepgram',
      scenarios: [
        { scenarioId: 'endpoint-1', kind: 'endpoint-finalization' },
        { scenarioId: 'reconnect-1', kind: 'reconnect' },
        { scenarioId: 'pause-1', kind: 'false-finalization' },
      ],
      executor,
      costPerLiveHourTwoChannelsUsd: 0.52,
      euProcessingAvailable: true,
      clock: () => Date.parse('2026-09-13T12:00:00.000Z'),
    });

    expect(order).toEqual(['endpoint-1', 'reconnect-1', 'pause-1']);
    expect(result.observations).toEqual([
      {
        providerId: 'deepgram',
        scenarioId: 'endpoint-1',
        kind: 'endpoint-finalization',
        delayMs: 180,
      },
      {
        providerId: 'deepgram',
        scenarioId: 'reconnect-1',
        kind: 'reconnect',
        succeeded: true,
        recoveryMs: 450,
      },
      {
        providerId: 'deepgram',
        scenarioId: 'pause-1',
        kind: 'false-finalization',
        falselyFinalized: false,
      },
    ]);
    expect(result.evidence).toEqual({
      providerId: 'deepgram',
      endpointFinalizationP95Ms: 180,
      reconnectSuccessRate: 1,
      recoveryP95Ms: 450,
      falseFinalizationRate: 0,
      costPerLiveHourTwoChannelsUsd: 0.52,
      euProcessingAvailable: true,
    });
    expect(result.artifact).toEqual({
      schemaVersion: 1,
      benchmarkRunId: 'run-2026-09-13',
      corpusVersion: 'corpus-v1',
      providerId: 'deepgram',
      measuredAt: '2026-09-13T12:00:00.000Z',
      evidence: result.evidence,
    });
  });

  it('records a failed reconnect without inventing recovery latency', async () => {
    const executor = createExecutor();
    executor.measureReconnect = vi.fn(async () => ({
      disconnectedAtMs: 2_000,
      recoveredAtMs: null,
    }));

    const result = await runTranscriptOperationalScenarios({
      benchmarkRunId: 'run-1',
      corpusVersion: 'corpus-v1',
      providerId: 'deepgram',
      scenarios: [{ scenarioId: 'reconnect-1', kind: 'reconnect' }],
      executor,
      clock: () => 0,
    });

    expect(result.observations[0]).toEqual({
      providerId: 'deepgram',
      scenarioId: 'reconnect-1',
      kind: 'reconnect',
      succeeded: false,
      recoveryMs: null,
    });
    expect(result.evidence.reconnectSuccessRate).toBe(0);
    expect(result.evidence.recoveryP95Ms).toBeNull();
  });

  it('rejects provider mismatches and duplicate scenarios before executing anything', async () => {
    const executor = createExecutor();

    await expect(
      runTranscriptOperationalScenarios({
        benchmarkRunId: 'run-1',
        corpusVersion: 'corpus-v1',
        providerId: 'assemblyai',
        scenarios: [{ scenarioId: 'endpoint-1', kind: 'endpoint-finalization' }],
        executor,
      }),
    ).rejects.toThrow(/executor provider mismatch/);

    await expect(
      runTranscriptOperationalScenarios({
        benchmarkRunId: 'run-1',
        corpusVersion: 'corpus-v1',
        providerId: 'deepgram',
        scenarios: [
          { scenarioId: 'same', kind: 'endpoint-finalization' },
          { scenarioId: 'same', kind: 'reconnect' },
        ],
        executor,
      }),
    ).rejects.toThrow('duplicate operational scenario: same');

    expect(executor.measureEndpointFinalization).not.toHaveBeenCalled();
    expect(executor.measureReconnect).not.toHaveBeenCalled();
  });

  it('fails closed on impossible timing measurements', async () => {
    const executor = createExecutor();
    executor.measureEndpointFinalization = vi.fn(async () => ({
      audioEndedAtMs: 2_000,
      finalTranscriptObservedAtMs: 1_999,
    }));

    await expect(
      runTranscriptOperationalScenarios({
        benchmarkRunId: 'run-1',
        corpusVersion: 'corpus-v1',
        providerId: 'deepgram',
        scenarios: [{ scenarioId: 'endpoint-1', kind: 'endpoint-finalization' }],
        executor,
      }),
    ).rejects.toThrow(/ended before it started/);
  });
});
