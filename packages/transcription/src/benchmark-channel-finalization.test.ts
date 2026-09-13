import { describe, expect, it, vi } from 'vitest';

import { createTranscriptChannelEndpointFinalizationScenarioExecutor } from './benchmark-channel-finalization.js';
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

const chunk: AudioChunk = {
  sessionId: request.sessionId,
  source: request.source,
  sequence: 0,
  capturedAtMs: 1_000,
  sampleRateHz: 16_000,
  channels: 1,
  encoding: 'pcm-s16le',
  data: new Uint8Array([1, 2, 3, 4]),
};

describe('createTranscriptChannelEndpointFinalizationScenarioExecutor', () => {
  it('measures audio-end to final transcript through TranscriptionChannel close', async () => {
    let now = 1_000;
    const writes: AudioChunk[] = [];
    let emit: TranscriptionProviderEventHandler | undefined;
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(connectRequest, onEvent) {
        expect(connectRequest).toEqual(request);
        emit = onEvent;
        onEvent({ type: 'ready' });
        return {
          write: async (audioChunk) => {
            writes.push(audioChunk);
          },
          close: async () => {
            now = 1_120;
            emit?.({
              type: 'transcript',
              segmentId: 'final-1',
              text: 'What is your experience with Symfony?',
              isFinal: true,
              startedAtMs: 900,
              endedAtMs: 1_000,
            });
            emit?.({ type: 'closed', reason: 'fixture-complete' });
          },
        };
      },
    };

    const executor = createTranscriptChannelEndpointFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider,
        request,
        chunks: [chunk],
        audioEndedAtMs: 1_000,
      }),
      clock: () => now,
      timeoutMs: 100,
    });

    await expect(executor.measureEndpointFinalization('question-finalization')).resolves.toEqual({
      audioEndedAtMs: 1_000,
      finalTranscriptObservedAtMs: 1_120,
    });
    expect(writes).toEqual([chunk]);
    expect(writes.every((value) => value.source === 'remote')).toBe(true);
  });

  it('fails closed when the provider closes without a final transcript', async () => {
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect(_connectRequest, onEvent) {
        onEvent({ type: 'ready' });
        return {
          write: async () => undefined,
          close: async () => {
            onEvent({ type: 'closed', reason: 'no-final' });
          },
        };
      },
    };
    const executor = createTranscriptChannelEndpointFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({ provider, request, chunks: [chunk], audioEndedAtMs: 1_000 }),
      clock: () => 1_100,
      timeoutMs: 100,
    });

    await expect(executor.measureEndpointFinalization('missing-final')).rejects.toThrow(
      'without a final transcript',
    );
  });

  it('rejects provider mismatches and invalid benchmark timing before writing audio', async () => {
    const write = vi.fn(async () => undefined);
    const provider: TranscriptionProvider = {
      id: 'other-stt',
      async connect() {
        return { write, close: async () => undefined };
      },
    };
    const mismatch = createTranscriptChannelEndpointFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({ provider, request, chunks: [chunk], audioEndedAtMs: 1_000 }),
    });

    await expect(mismatch.measureEndpointFinalization('wrong-provider')).rejects.toThrow(
      'provider mismatch',
    );
    expect(write).not.toHaveBeenCalled();

    const timingProvider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect() {
        return { write, close: async () => undefined };
      },
    };
    const invalidTiming = createTranscriptChannelEndpointFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({
        provider: timingProvider,
        request,
        chunks: [chunk],
        audioEndedAtMs: 999,
      }),
    });

    await expect(invalidTiming.measureEndpointFinalization('bad-audio-end')).rejects.toThrow(
      'before an audio chunk capture time',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects empty chunks and invalid executor configuration', async () => {
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      async connect() {
        throw new Error('must not connect');
      },
    };
    const empty = createTranscriptChannelEndpointFinalizationScenarioExecutor({
      providerId: 'fake-stt',
      createScenario: () => ({ provider, request, chunks: [], audioEndedAtMs: 1_000 }),
    });
    await expect(empty.measureEndpointFinalization('empty-audio')).rejects.toThrow(
      'at least one audio chunk',
    );

    expect(() =>
      createTranscriptChannelEndpointFinalizationScenarioExecutor({
        providerId: ' fake-stt',
        createScenario: () => {
          throw new Error('must not run');
        },
      }),
    ).toThrow('canonical');

    expect(() =>
      createTranscriptChannelEndpointFinalizationScenarioExecutor({
        providerId: 'fake-stt',
        timeoutMs: 0,
        createScenario: () => {
          throw new Error('must not run');
        },
      }),
    ).toThrow('positive finite');
  });
});
