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
