import { describe, expect, it, vi } from 'vitest';

import { startLiveAudioStream } from './live-audio-stream.js';

interface Harness {
  readonly stream: MediaStream;
  readonly processor: ScriptProcessorNode;
  readonly track: MediaStreamTrack;
  emit(samples: readonly Float32Array[]): void;
  end(): void;
}

function createHarness(sampleRate = 16_000): Harness {
  let ended: (() => void) | undefined;
  const track = {
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn((_name: string, listener: EventListenerOrEventListenerObject) => {
      ended = typeof listener === 'function' ? () => listener(new Event('ended')) : undefined;
    }),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as MediaStreamAudioSourceNode;
  const processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
  } as unknown as ScriptProcessorNode;

  return {
    stream,
    processor,
    track,
    emit: (samples) => {
      const handler = processor.onaudioprocess;
      if (!handler) throw new Error('Audio processor is not active.');
      handler.call(
        processor,
        {
          inputBuffer: {
            numberOfChannels: samples.length,
            getChannelData: (index: number) => samples[index] ?? new Float32Array(0),
          },
        } as unknown as AudioProcessingEvent,
      );
    },
    end: () => ended?.(),
  };
}

function dependenciesFor(
  harness: Harness,
  writes: RendererAudioChunk[],
  sampleRate = 16_000,
) {
  const context = {
    sampleRate,
    state: 'running',
    destination: {},
    createMediaStreamSource: () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createScriptProcessor: () => harness.processor,
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as AudioContext;

  return {
    createAudioContext: () => context,
    writeChunk: vi.fn(async (chunk: RendererAudioChunk) => {
      writes.push(chunk);
    }),
    now: () => 1_000,
  };
}

describe('startLiveAudioStream', () => {
  it('keeps local and remote channels independently sequenced', async () => {
    const localHarness = createHarness();
    const remoteHarness = createHarness();
    const localWrites: RendererAudioChunk[] = [];
    const remoteWrites: RendererAudioChunk[] = [];

    const local = await startLiveAudioStream(
      { stream: localHarness.stream, source: 'local', sessionId: 'session-1' },
      dependenciesFor(localHarness, localWrites),
    );
    const remote = await startLiveAudioStream(
      { stream: remoteHarness.stream, source: 'remote', sessionId: 'session-1' },
      dependenciesFor(remoteHarness, remoteWrites),
    );

    const samples = new Float32Array(320).fill(0.25);
    localHarness.emit([samples]);
    remoteHarness.emit([samples]);
    await Promise.resolve();

    expect(localWrites).toHaveLength(1);
    expect(remoteWrites).toHaveLength(1);
    expect(localWrites[0]).toMatchObject({ source: 'local', sequence: 0, sampleRateHz: 16_000 });
    expect(remoteWrites[0]).toMatchObject({ source: 'remote', sequence: 0, sampleRateHz: 16_000 });
    expect(localWrites[0]?.data).toBeInstanceOf(Uint8Array);

    await local.stop();
    await remote.stop();
  });

  it('downmixes stereo input before encoding', async () => {
    const harness = createHarness();
    const writes: RendererAudioChunk[] = [];
    const handle = await startLiveAudioStream(
      { stream: harness.stream, source: 'local', sessionId: 'session-1' },
      dependenciesFor(harness, writes),
    );

    harness.emit([new Float32Array(320).fill(1), new Float32Array(320).fill(-1)]);
    await Promise.resolve();

    expect(writes).toHaveLength(1);
    expect(Array.from(writes[0]?.data ?? [])).toEqual(new Array(640).fill(0));
    await handle.stop();
  });

  it('stops and reports degraded state when the captured track ends', async () => {
    const harness = createHarness();
    const writes: RendererAudioChunk[] = [];
    const onDegraded = vi.fn();
    const handle = await startLiveAudioStream(
      {
        stream: harness.stream,
        source: 'remote',
        sessionId: 'session-1',
        onDegraded,
      },
      dependenciesFor(harness, writes),
    );

    harness.end();
    await Promise.resolve();

    expect(onDegraded).toHaveBeenCalledWith('track-ended');
    expect(harness.track.stop).toHaveBeenCalledOnce();
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('rejects streams without a live audio track', async () => {
    const harness = createHarness();
    Object.defineProperty(harness.track, 'readyState', { value: 'ended' });

    await expect(
      startLiveAudioStream(
        { stream: harness.stream, source: 'local', sessionId: 'session-1' },
        dependenciesFor(harness, []),
      ),
    ).rejects.toThrow('No live local audio track');
  });
});
