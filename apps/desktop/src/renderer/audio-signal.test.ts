import { describe, expect, it, vi } from 'vitest';

import { detectAudioSignal } from './audio-signal.js';

function createHarness(options: {
  readonly disconnectError?: Error;
  readonly closeError?: Error;
} = {}) {
  const disconnect = vi.fn(() => {
    if (options.disconnectError) throw options.disconnectError;
  });
  const close = vi.fn(async () => {
    if (options.closeError) throw options.closeError;
  });
  const analyser = {
    fftSize: 0,
    getByteTimeDomainData: vi.fn((samples: Uint8Array) => {
      samples.fill(128);
      samples[0] = 132;
    }),
  } as unknown as AnalyserNode;
  const source = {
    connect: vi.fn(),
    disconnect,
  } as unknown as MediaStreamAudioSourceNode;
  const context = {
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => source),
    close,
  } as unknown as AudioContext;

  return { context, disconnect, close };
}

describe('audio signal detection cleanup', () => {
  it('closes the audio context even when source disconnect throws', async () => {
    const disconnectError = new Error('disconnect failed');
    const harness = createHarness({ disconnectError });

    await expect(
      detectAudioSignal({} as MediaStream, () => harness.context),
    ).rejects.toBe(disconnectError);

    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('attempts both cleanup operations and keeps the first cleanup failure', async () => {
    const disconnectError = new Error('disconnect failed');
    const harness = createHarness({
      disconnectError,
      closeError: new Error('close failed'),
    });

    await expect(
      detectAudioSignal({} as MediaStream, () => harness.context),
    ).rejects.toBe(disconnectError);

    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(harness.close).toHaveBeenCalledOnce();
  });
});
