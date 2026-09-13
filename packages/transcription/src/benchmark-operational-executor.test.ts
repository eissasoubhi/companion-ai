import { describe, expect, it, vi } from 'vitest';

import { composeTranscriptOperationalScenarioExecutor } from './benchmark-operational-executor.js';

describe('composeTranscriptOperationalScenarioExecutor', () => {
  it('delegates all scenario kinds to matching executor parts', async () => {
    const measureEndpointFinalization = vi.fn(async (scenarioId: string) => ({
      audioEndedAtMs: scenarioId.length,
      finalTranscriptObservedAtMs: scenarioId.length + 10,
    }));
    const measureReconnect = vi.fn(async (scenarioId: string) => ({
      disconnectedAtMs: scenarioId.length,
      recoveredAtMs: scenarioId.length + 20,
    }));
    const measureFalseFinalization = vi.fn(async () => ({ falselyFinalized: false }));

    const executor = composeTranscriptOperationalScenarioExecutor({
      endpointFinalization: { providerId: 'deepgram:nova-3', measureEndpointFinalization },
      reconnect: { providerId: 'deepgram:nova-3', measureReconnect },
      falseFinalization: { providerId: 'deepgram:nova-3', measureFalseFinalization },
    });

    await expect(executor.measureEndpointFinalization('endpoint')).resolves.toEqual({
      audioEndedAtMs: 8,
      finalTranscriptObservedAtMs: 18,
    });
    await expect(executor.measureReconnect('reconnect')).resolves.toEqual({
      disconnectedAtMs: 9,
      recoveredAtMs: 29,
    });
    await expect(executor.measureFalseFinalization('pause')).resolves.toEqual({
      falselyFinalized: false,
    });

    expect(executor.providerId).toBe('deepgram:nova-3');
    expect(measureEndpointFinalization).toHaveBeenCalledWith('endpoint');
    expect(measureReconnect).toHaveBeenCalledWith('reconnect');
    expect(measureFalseFinalization).toHaveBeenCalledWith('pause');
  });

  it('fails closed when executor parts belong to different providers', () => {
    expect(() =>
      composeTranscriptOperationalScenarioExecutor({
        endpointFinalization: {
          providerId: 'deepgram:nova-3',
          measureEndpointFinalization: vi.fn(),
        },
        reconnect: {
          providerId: 'assemblyai:universal-3-5-pro',
          measureReconnect: vi.fn(),
        },
        falseFinalization: {
          providerId: 'deepgram:nova-3',
          measureFalseFinalization: vi.fn(),
        },
      }),
    ).toThrow(/provider mismatch/);
  });

  it.each(['', ' deepgram:nova-3', 'deepgram:nova-3 '])(
    'rejects non-canonical provider id %j',
    (providerId) => {
      expect(() =>
        composeTranscriptOperationalScenarioExecutor({
          endpointFinalization: {
            providerId,
            measureEndpointFinalization: vi.fn(),
          },
          reconnect: {
            providerId,
            measureReconnect: vi.fn(),
          },
          falseFinalization: {
            providerId,
            measureFalseFinalization: vi.fn(),
          },
        }),
      ).toThrow(/canonical identifier/);
    },
  );
});
