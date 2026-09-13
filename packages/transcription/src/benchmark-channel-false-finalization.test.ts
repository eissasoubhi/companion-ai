import { describe, expect, it, vi } from 'vitest';

import { createTranscriptChannelFalseFinalizationScenarioExecutor } from './benchmark-channel-false-finalization.js';
import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from './types.js';

const request: TranscriptionConnectRequest = {
  sessionId: 'benchmark-session',
  source: 'remote',
  partialResults: true,
};

const beforePause: AudioChunk = {
  sessionId: request.sessionId,
  source: request.source,
  sequence: 0,
  capturedAtMs: 1_000,
  sampleRateHz: 16_000,
  channels: 1,
  encoding: 'pcm-s16le',
  data: new Uint8Array([1, 2]),
};

const afterPause: AudioChunk = {
  ...beforePause,
  sequence: 1,
  capturedAtMs: 1_600,
  data: new Uint8Array([3, 4]),
};

function createProvider(onClose?: () => void) {
  let emit: TranscriptionProviderEventHandler | undefined;
  const writes: AudioChunk[] = [];
  const provider: TranscriptionProvider = {
    id: 'fake-stt',
    async connect(connectRequest, onEvent) {
      expect(connectRequest).toEqual(request);
      emit = onEvent;
      onEvent({ type: 'ready' });
      return {
        write: async (chunk) => {
          writes.push(chunk);
        },
        close: async () => {
          onClose?.();
          onEvent({ type: 'closed', reason: 'fixture-complete' });
        },
      };
    },
  };
  return { provider, writes, emit: () => emit };
}

describe('createTranscriptChannelFalseFinalizationScenarioExecutor', () => {
  it('reports a false finalization emitted during a natural pause', async () => {
    const fixture = createProvider();
    const executor = createTranscriptChannelFalseFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider: fixture.provider,
        request,
        beforePauseChunks: [beforePause],
        afterPauseChunks: [afterPause],
        waitDuringPause: async () => {
          fixture.emit()?.({
            type: 'transcript',
            segmentId: 'premature-final',
            text: 'Tell me about',
            isFinal: true,
            startedAtMs: 900,
            endedAtMs: 1_000,
          });
        },
      }),
      timeoutMs: 100,
    });

    await expect(executor.measureFalseFinalization('natural-pause')).resolves.toEqual({
      falselyFinalized: true,
    });
    expect(fixture.writes).toEqual([beforePause, afterPause]);
    expect(fixture.writes.every((chunk) => chunk.source === 'remote')).toBe(true);
  });

  it('does not count finals outside the pause window', async () => {
    const fixture = createProvider();
    const executor = createTranscriptChannelFalseFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider: fixture.provider,
        request,
        beforePauseChunks: [beforePause],
        afterPauseChunks: [afterPause],
        waitDuringPause: async () => undefined,
      }),
      timeoutMs: 100,
    });

    await expect(executor.measureFalseFinalization('clean-pause')).resolves.toEqual({
      falselyFinalized: false,
    });
  });

  it('fails closed on provider mismatch or missing audio around the pause', async () => {
    const write = vi.fn(async () => undefined);
    const wrongProvider: TranscriptionProvider = {
      id: 'other-stt',
      async connect() {
        return { write, close: async () => undefined };
      },
    };
    const mismatch = createTranscriptChannelFalseFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider: wrongProvider,
        request,
        beforePauseChunks: [beforePause],
        afterPauseChunks: [afterPause],
        waitDuringPause: async () => undefined,
      }),
    });
    await expect(mismatch.measureFalseFinalization('wrong-provider')).rejects.toThrow(
      'provider mismatch',
    );
    expect(write).not.toHaveBeenCalled();

    const fixture = createProvider();
    const missingResume = createTranscriptChannelFalseFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider: fixture.provider,
        request,
        beforePauseChunks: [beforePause],
        afterPauseChunks: [],
        waitDuringPause: async () => undefined,
      }),
    });
    await expect(missingResume.measureFalseFinalization('missing-resume')).rejects.toThrow(
      'audio before and after',
    );
  });

  it('bounds a stalled pause and rejects invalid configuration', async () => {
    const fixture = createProvider();
    const stalled = createTranscriptChannelFalseFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider: fixture.provider,
        request,
        beforePauseChunks: [beforePause],
        afterPauseChunks: [afterPause],
        waitDuringPause: () => new Promise<void>(() => undefined),
      }),
      timeoutMs: 5,
    });
    await expect(stalled.measureFalseFinalization('stalled-pause')).rejects.toThrow('timed out');

    expect(() =>
      createTranscriptChannelFalseFinalizationScenarioExecutor({
        providerId: ' fake-stt',
        createScenario: () => {
          throw new Error('must not run');
        },
      }),
    ).toThrow('canonical');
    expect(() =>
      createTranscriptChannelFalseFinalizationScenarioExecutor({
        providerId: 'fake-stt',
        timeoutMs: 0,
        createScenario: () => {
          throw new Error('must not run');
        },
      }),
    ).toThrow('positive finite');
  });
});
