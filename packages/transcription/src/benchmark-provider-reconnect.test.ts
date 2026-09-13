import { describe, expect, it, vi } from 'vitest';

import { createDeepgramReconnectScenarioExecutor } from './benchmark-provider-reconnect.js';
import type {
  DeepgramSocket,
  DeepgramSocketCloseEvent,
} from './providers/deepgram.js';
import type { TranscriptionConnectRequest } from './types.js';

function reconnectingSocket(onCreated: () => void): DeepgramSocket {
  let closeHandler: ((event: DeepgramSocketCloseEvent) => void) | undefined;
  onCreated();
  return {
    send: () => undefined,
    close: (code, reason) => {
      queueMicrotask(() => closeHandler?.({ code, reason }));
    },
    onOpen: (handler) => queueMicrotask(handler),
    onMessage: () => undefined,
    onError: () => undefined,
    onClose: (handler) => {
      closeHandler = handler;
    },
  };
}

const remoteRequest: TranscriptionConnectRequest = {
  sessionId: 'provider-reconnect-benchmark',
  source: 'remote',
  partialResults: true,
};

describe('provider reconnect scenario executors', () => {
  it('measures controlled disconnect recovery through the real Deepgram adapter', async () => {
    let now = 1_000;
    let socketCount = 0;
    const createSocket = vi.fn(() => reconnectingSocket(() => socketCount += 1));
    const executor = createDeepgramReconnectScenarioExecutor(
      {
        createSocket,
        audioFormat: { encoding: 'pcm-s16le', sampleRateHz: 16_000, channels: 1 },
        openTimeoutMs: 100,
        closeTimeoutMs: 1,
      },
      remoteRequest,
      {
        reconnectPolicy: { maxAttempts: 2, baseDelayMs: 25, maxDelayMs: 25 },
        clock: () => now,
        sleep: async (delayMs) => {
          now += delayMs;
        },
        timeoutMs: 100,
      },
    );

    await expect(executor.measureReconnect('deepgram-controlled-disconnect')).resolves.toEqual({
      disconnectedAtMs: 1_000,
      recoveredAtMs: 1_025,
    });
    expect(socketCount).toBe(2);
    expect(createSocket).toHaveBeenCalledTimes(2);
  });

  it('creates a fresh controlled socket lifecycle for every measured scenario', async () => {
    let socketCount = 0;
    const executor = createDeepgramReconnectScenarioExecutor(
      {
        createSocket: () => reconnectingSocket(() => socketCount += 1),
        audioFormat: { encoding: 'pcm-s16le', sampleRateHz: 16_000, channels: 1 },
        openTimeoutMs: 100,
        closeTimeoutMs: 1,
      },
      { ...remoteRequest, source: 'local' },
      {
        reconnectPolicy: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
        sleep: async () => undefined,
        clock: () => 2_000,
        timeoutMs: 100,
      },
    );

    await executor.measureReconnect('first');
    await executor.measureReconnect('second');

    expect(socketCount).toBe(4);
  });
});
