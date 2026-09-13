import { describe, expect, it, vi } from 'vitest';

import { createTranscriptChannelReconnectScenarioExecutor } from './benchmark-channel-reconnect.js';
import type {
  TranscriptionConnectRequest,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from './types.js';

const request: TranscriptionConnectRequest = {
  sessionId: 'benchmark-session',
  source: 'remote',
  partialResults: true,
};

describe('createTranscriptChannelReconnectScenarioExecutor', () => {
  it('measures disconnect to provider-ready recovery through TranscriptionChannel', async () => {
    let now = 1_000;
    let activeEmit: TranscriptionProviderEventHandler | undefined;
    const requests: TranscriptionConnectRequest[] = [];
    const close = vi.fn(async () => undefined);
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(connectRequest, onEvent) {
        requests.push(connectRequest);
        activeEmit = onEvent;
        onEvent({ type: 'ready' });
        return { write: async () => undefined, close };
      },
    };

    const executor = createTranscriptChannelReconnectScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider,
        request,
        triggerDisconnect: () => {
          activeEmit?.({
            type: 'error',
            code: 'socket-reset',
            message: 'connection reset',
            retryable: true,
          });
        },
      }),
      reconnectPolicy: { maxAttempts: 2, baseDelayMs: 25, maxDelayMs: 25 },
      clock: () => now,
      sleep: async (delayMs) => {
        now += delayMs;
      },
      timeoutMs: 100,
    });

    await expect(executor.measureReconnect('socket-reset')).resolves.toEqual({
      disconnectedAtMs: 1_000,
      recoveredAtMs: 1_025,
    });
    expect(requests).toEqual([request, request]);
    expect(requests.every((value) => value.source === 'remote')).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('returns a failed recovery when reconnect attempts are exhausted', async () => {
    let activeEmit: TranscriptionProviderEventHandler | undefined;
    let connectCount = 0;
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(_request, onEvent) {
        connectCount += 1;
        if (connectCount > 1) throw new Error('provider unavailable');
        activeEmit = onEvent;
        onEvent({ type: 'ready' });
        return { write: async () => undefined, close: async () => undefined };
      },
    };

    const executor = createTranscriptChannelReconnectScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider,
        request,
        triggerDisconnect: () => {
          activeEmit?.({ type: 'error', code: 'network', message: 'offline', retryable: true });
        },
      }),
      reconnectPolicy: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
      sleep: async () => undefined,
      clock: () => 2_000,
      timeoutMs: 100,
    });

    await expect(executor.measureReconnect('provider-unavailable')).resolves.toEqual({
      disconnectedAtMs: 2_000,
      recoveredAtMs: null,
    });
    expect(connectCount).toBe(2);
  });

  it('fails closed before measuring a harness for the wrong provider', async () => {
    const provider: TranscriptionProvider = {
      id: 'other-stt',
      connect: async () => ({ write: async () => undefined, close: async () => undefined }),
    };
    const triggerDisconnect = vi.fn();
    const executor = createTranscriptChannelReconnectScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({ provider, request, triggerDisconnect }),
    });

    await expect(executor.measureReconnect('wrong-provider')).rejects.toThrow(
      'provider mismatch',
    );
    expect(triggerDisconnect).not.toHaveBeenCalled();
  });

  it('rejects non-canonical identifiers and invalid timeout configuration', async () => {
    expect(() =>
      createTranscriptChannelReconnectScenarioExecutor({
        providerId: ' fake-stt',
        createScenario: () => {
          throw new Error('must not run');
        },
      }),
    ).toThrow('canonical');

    expect(() =>
      createTranscriptChannelReconnectScenarioExecutor({
        providerId: 'fake-stt',
        timeoutMs: 0,
        createScenario: () => {
          throw new Error('must not run');
        },
      }),
    ).toThrow('positive finite');
  });
});
