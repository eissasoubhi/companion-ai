import { describe, expect, it, vi } from 'vitest';

import { startLiveAudioStream } from './live-audio-stream.js';

describe('live audio cleanup', () => {
  it('stops tracks and closes the context even if node disconnect throws', async () => {
    const track = {
      readyState: 'live',
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    const sourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(() => { throw new Error('source disconnect failed'); }),
    } as unknown as MediaStreamAudioSourceNode;
    const processor = {
      connect: vi.fn(),
      disconnect: vi.fn(() => { throw new Error('processor disconnect failed'); }),
      onaudioprocess: null,
    } as unknown as ScriptProcessorNode;
    const close = vi.fn(async () => undefined);
    const context = {
      sampleRate: 16_000,
      state: 'running',
      destination: {},
      createMediaStreamSource: () => sourceNode,
      createScriptProcessor: () => processor,
      resume: vi.fn(async () => undefined),
      close,
    } as unknown as AudioContext;

    const handle = await startLiveAudioStream(
      { stream, source: 'local', sessionId: 'session-cleanup' },
      {
        createAudioContext: () => context,
        writeChunk: vi.fn(async () => undefined),
        now: () => 1_000,
      },
    );

    await expect(handle.stop()).rejects.toThrow('source disconnect failed');
    expect(sourceNode.disconnect).toHaveBeenCalledOnce();
    expect(processor.disconnect).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('attempts every track and closes the context when one track stop throws', async () => {
    const firstTrack = {
      readyState: 'live',
      stop: vi.fn(() => { throw new Error('first track stop failed'); }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const secondTrack = {
      readyState: 'live',
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [firstTrack, secondTrack],
      getTracks: () => [firstTrack, secondTrack],
    } as unknown as MediaStream;
    const sourceNode = { connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
    const processor = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    } as unknown as ScriptProcessorNode;
    const close = vi.fn(async () => undefined);
    const context = {
      sampleRate: 16_000,
      state: 'running',
      destination: {},
      createMediaStreamSource: () => sourceNode,
      createScriptProcessor: () => processor,
      resume: vi.fn(async () => undefined),
      close,
    } as unknown as AudioContext;

    const handle = await startLiveAudioStream(
      { stream, source: 'local', sessionId: 'session-track-stop-cleanup' },
      {
        createAudioContext: () => context,
        writeChunk: vi.fn(async () => undefined),
        now: () => 1_000,
      },
    );

    await expect(handle.stop()).rejects.toThrow('first track stop failed');
    expect(firstTrack.stop).toHaveBeenCalledOnce();
    expect(secondTrack.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
