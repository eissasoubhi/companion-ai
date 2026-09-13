import { describe, expect, it, vi } from 'vitest';

import { reconnectDelayMs, shouldReconnect, TranscriptionChannel } from './channel.js';
import type {
  AudioChunk,
  TranscriptionConnection,
  TranscriptionPipelineEvent,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from './types.js';

function audioChunk(sequence: number): AudioChunk {
  return {
    sessionId: 'session-1',
    source: 'remote',
    sequence,
    capturedAtMs: 900,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: 'pcm-s16le',
    data: new Uint8Array([1, 2, 3, 4]),
  };
}

describe('TranscriptionChannel', () => {
  it('keeps provider events attributed to the configured session and source', async () => {
    const events: TranscriptionPipelineEvent[] = [];
    let providerEmit: TranscriptionProviderEventHandler | undefined;
    const connection: TranscriptionConnection = {
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(_request, onEvent) {
        providerEmit = onEvent;
        onEvent({ type: 'ready' });
        return connection;
      },
    };

    const channel = await TranscriptionChannel.open(
      provider,
      {
        sessionId: 'session-1',
        source: 'remote',
        partialResults: true,
      },
      (event) => events.push(event),
      () => 1_250,
    );

    providerEmit?.({
      type: 'transcript',
      segmentId: 'provider-segment-7',
      text: '  Tell me about your last project.  ',
      isFinal: true,
      startedAtMs: 1_000,
      endedAtMs: 1_100,
    });

    expect(events[0]).toMatchObject({
      type: 'provider-ready',
      providerId: 'fake-stt',
      sessionId: 'session-1',
      source: 'remote',
    });
    expect(events[1]).toMatchObject({
      type: 'transcript',
      segment: {
        id: 'session-1:remote:provider-segment-7',
        source: 'remote',
        text: 'Tell me about your last project.',
        isFinal: true,
      },
      latency: {
        lagMs: 150,
      },
    });

    await channel.close();
  });

  it('uses the write promise as backpressure and only advances sequence after acceptance', async () => {
    let resolveWrite: (() => void) | undefined;
    const writes: number[] = [];
    const connection: TranscriptionConnection = {
      write: vi.fn(
        (chunk) =>
          new Promise<void>((resolve) => {
            writes.push(chunk.sequence);
            resolveWrite = resolve;
          }),
      ),
      close: vi.fn(async () => undefined),
    };
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      connect: async () => connection,
    };

    const channel = await TranscriptionChannel.open(
      provider,
      { sessionId: 'session-1', source: 'remote', partialResults: true },
      () => undefined,
    );

    const pending = channel.writeAudio(audioChunk(0));
    expect(writes).toEqual([0]);

    await expect(channel.writeAudio(audioChunk(1))).rejects.toThrow('backpressure');
    expect(writes).toEqual([0]);

    resolveWrite?.();
    await pending;

    await expect(channel.writeAudio(audioChunk(0))).rejects.toThrow('sequence');
    await channel.close();
  });

  it('rejects chunks from another source before they reach the provider', async () => {
    const write = vi.fn(async () => undefined);
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      connect: async () => ({ write, close: async () => undefined }),
    };

    const channel = await TranscriptionChannel.open(
      provider,
      { sessionId: 'session-1', source: 'remote', partialResults: true },
      () => undefined,
    );

    await expect(
      channel.writeAudio({ ...audioChunk(0), source: 'local' }),
    ).rejects.toThrow('does not belong');
    expect(write).not.toHaveBeenCalled();
  });

  it('fails closed before publishing an active provider terminal closure', async () => {
    const events: TranscriptionPipelineEvent[] = [];
    const write = vi.fn(async () => undefined);
    let providerEmit: TranscriptionProviderEventHandler | undefined;
    let channel: TranscriptionChannel | undefined;
    let reentrantWrite: Promise<void> | undefined;
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(_request, onEvent) {
        providerEmit = onEvent;
        return { write, close: async () => undefined };
      },
    };

    channel = await TranscriptionChannel.open(
      provider,
      { sessionId: 'session-1', source: 'remote', partialResults: true },
      (event) => {
        events.push(event);
        if (event.type === 'provider-closed') {
          reentrantWrite = channel?.writeAudio(audioChunk(0));
        }
      },
    );

    providerEmit?.({ type: 'closed', reason: 'provider-ended-stream' });

    expect(events).toContainEqual({
      type: 'provider-closed',
      providerId: 'fake-stt',
      sessionId: 'session-1',
      source: 'remote',
      reason: 'provider-ended-stream',
    });
    expect(reentrantWrite).toBeDefined();
    await expect(reentrantWrite!).rejects.toThrow('closed');
    await expect(channel.writeAudio(audioChunk(0))).rejects.toThrow('closed');
    expect(write).not.toHaveBeenCalled();
  });

  it('forwards a final transcript emitted while the provider connection is closing', async () => {
    const events: TranscriptionPipelineEvent[] = [];
    let providerEmit: TranscriptionProviderEventHandler | undefined;
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(_request, onEvent) {
        providerEmit = onEvent;
        return {
          write: async () => undefined,
          close: async () => {
            providerEmit?.({
              type: 'transcript',
              segmentId: 'final-on-close',
              text: 'Final answer',
              isFinal: true,
              startedAtMs: 1_000,
              endedAtMs: 1_100,
            });
          },
        };
      },
    };

    const channel = await TranscriptionChannel.open(
      provider,
      { sessionId: 'session-1', source: 'remote', partialResults: true },
      (event) => events.push(event),
      () => 1_150,
    );

    await channel.close();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'transcript',
        segment: expect.objectContaining({
          id: 'session-1:remote:final-on-close',
          source: 'remote',
          text: 'Final answer',
          isFinal: true,
        }),
      }),
    );
    await expect(channel.writeAudio(audioChunk(0))).rejects.toThrow('closed');
  });

  it('reconnects retryable failures without buffering audio or accepting stale events', async () => {
    const events: TranscriptionPipelineEvent[] = [];
    const emitters: TranscriptionProviderEventHandler[] = [];
    const writes = [vi.fn(async () => undefined), vi.fn(async () => undefined)];
    const closes = [vi.fn(async () => undefined), vi.fn(async () => undefined)];
    let connectCount = 0;
    let resumeSleep: (() => void) | undefined;
    const sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resumeSleep = resolve;
        }),
    );
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(request, onEvent) {
        expect(request).toEqual({
          sessionId: 'session-1',
          source: 'remote',
          partialResults: true,
        });
        const index = connectCount;
        connectCount += 1;
        emitters.push(onEvent);
        return { write: writes[index]!, close: closes[index]! };
      },
    };

    const channel = await TranscriptionChannel.open(
      provider,
      { sessionId: 'session-1', source: 'remote', partialResults: true },
      (event) => events.push(event),
      () => 2_000,
      { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 20 },
      sleep,
    );

    emitters[0]?.({
      type: 'error',
      code: 'socket-reset',
      message: 'socket reset',
      retryable: true,
    });

    await expect(channel.writeAudio(audioChunk(0))).rejects.toThrow('reconnecting');
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(10));
    expect(closes[0]).toHaveBeenCalledTimes(1);

    resumeSleep?.();
    await vi.waitFor(() => expect(connectCount).toBe(2));
    emitters[1]?.({ type: 'ready' });
    await vi.waitFor(async () => {
      await channel.writeAudio(audioChunk(0));
      expect(writes[1]).toHaveBeenCalledTimes(1);
    });

    const eventCount = events.length;
    emitters[0]?.({
      type: 'transcript',
      segmentId: 'stale',
      text: 'stale transcript',
      isFinal: true,
      startedAtMs: 1_000,
      endedAtMs: 1_100,
    });
    expect(events).toHaveLength(eventCount);

    await channel.close();
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });

  it('closes fail-closed after bounded reconnect attempts are exhausted', async () => {
    const events: TranscriptionPipelineEvent[] = [];
    let initialEmit: TranscriptionProviderEventHandler | undefined;
    let connectCount = 0;
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(_request, onEvent) {
        connectCount += 1;
        if (connectCount === 1) {
          initialEmit = onEvent;
          return {
            write: async () => undefined,
            close: async () => undefined,
          };
        }
        throw new Error(`connect failure ${connectCount}`);
      },
    };

    const channel = await TranscriptionChannel.open(
      provider,
      { sessionId: 'session-1', source: 'remote', partialResults: true },
      (event) => events.push(event),
      () => 2_000,
      { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
      async () => undefined,
    );

    initialEmit?.({
      type: 'error',
      code: 'temporary',
      message: 'temporary failure',
      retryable: true,
    });

    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'provider-closed',
          reason: 'reconnect-attempts-exhausted',
        }),
      );
    });
    expect(connectCount).toBe(3);
    expect(
      events.filter(
        (event) =>
          event.type === 'provider-error' && event.code === 'reconnect-connect-failed',
      ),
    ).toHaveLength(2);
    await expect(channel.writeAudio(audioChunk(0))).rejects.toThrow('closed');
  });
});

describe('reconnect policy', () => {
  it('uses bounded exponential delays', () => {
    expect(reconnectDelayMs(1)).toBe(250);
    expect(reconnectDelayMs(2)).toBe(500);
    expect(reconnectDelayMs(5)).toBe(4_000);
  });

  it('never reconnects non-retryable failures and respects the attempt limit', () => {
    expect(shouldReconnect(false, 0)).toBe(false);
    expect(shouldReconnect(true, 3)).toBe(true);
    expect(shouldReconnect(true, 4)).toBe(false);
  });
});
