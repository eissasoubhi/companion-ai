import { describe, expect, it } from 'vitest';

import {
  createAssemblyAIOperationalScenarioExecutor,
  createDeepgramOperationalScenarioExecutor,
  createOpenAIOperationalScenarioExecutor,
  rebaseTranscriptOperationalChunks,
  type TranscriptOperationalAudioFixtures,
} from './benchmark-provider-operational.js';
import type { AssemblyAIProviderConfig } from './providers/assemblyai.js';
import type { DeepgramProviderConfig } from './providers/deepgram.js';
import type { OpenAILiveTranscriptionConfig } from './providers/openai.js';
import type { AudioChunk } from './types.js';

const request = {
  sessionId: 'benchmark-session',
  source: 'remote',
  partialResults: true,
} as const;

const fixtures: TranscriptOperationalAudioFixtures = {
  endpointFinalization: {
    chunks: [],
    audioEndedAtMs: 1_000,
  },
  falseFinalization: {
    beforePauseChunks: [],
    afterPauseChunks: [],
    pauseMs: 250,
  },
};

const deepgramConfig: DeepgramProviderConfig = {
  audioFormat: { encoding: 'pcm-s16le', sampleRateHz: 16_000, channels: 1 },
  createSocket: () => {
    throw new Error('socket must not be created during composition');
  },
};

const assemblyAIConfig: AssemblyAIProviderConfig = {
  sampleRateHz: 16_000,
  createSocket: () => {
    throw new Error('socket must not be created during composition');
  },
};

const openAIConfig: OpenAILiveTranscriptionConfig = {
  sampleRateHz: 16_000,
  createSocket: () => {
    throw new Error('socket must not be created during composition');
  },
};

function chunk(sequence: number, capturedAtMs: number): AudioChunk {
  return {
    sessionId: 'benchmark-session',
    source: 'remote',
    sequence,
    capturedAtMs,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: 'pcm-s16le',
    data: new Uint8Array([sequence + 1]),
  };
}

describe('provider operational scenario executors', () => {
  it('composes all three shortlisted providers without opening a live socket', () => {
    expect(createDeepgramOperationalScenarioExecutor(deepgramConfig, request, fixtures).providerId).toBe(
      'deepgram:nova-3',
    );
    expect(
      createAssemblyAIOperationalScenarioExecutor(assemblyAIConfig, request, fixtures).providerId,
    ).toBe('assemblyai:universal-3-5-pro');
    expect(createOpenAIOperationalScenarioExecutor(openAIConfig, request, fixtures).providerId).toBe(
      'openai:gpt-live-transcribe',
    );
  });

  it('rejects non-positive or non-finite natural pause durations before any provider work', () => {
    for (const pauseMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createDeepgramOperationalScenarioExecutor(deepgramConfig, request, {
          ...fixtures,
          falseFinalization: { ...fixtures.falseFinalization, pauseMs },
        }),
      ).toThrow('falseFinalization.pauseMs must be a positive finite number');
    }
  });

  it('preserves an explicit bounded timeout across composition without creating sockets', () => {
    const executor = createOpenAIOperationalScenarioExecutor(openAIConfig, request, fixtures, {
      timeoutMs: 5_000,
    });
    expect(executor.providerId).toBe('openai:gpt-live-transcribe');
  });

  it('rebases stale fixture timestamps while preserving relative timing and payloads', () => {
    const input = [chunk(0, 100), chunk(1, 225), chunk(2, 450)];
    const rebased = rebaseTranscriptOperationalChunks(input, 10_000);

    expect(rebased.map((value) => value.capturedAtMs)).toEqual([10_000, 10_125, 10_350]);
    expect(rebased.map((value) => value.sequence)).toEqual([0, 1, 2]);
    expect(rebased.map((value) => [...value.data])).toEqual([[1], [2], [3]]);
    expect(input.map((value) => value.capturedAtMs)).toEqual([100, 225, 450]);
  });

  it('uses one explicit origin when rebasing chunks on opposite sides of a natural pause', () => {
    const before = rebaseTranscriptOperationalChunks([chunk(0, 1_000)], 50_000, 1_000);
    const after = rebaseTranscriptOperationalChunks([chunk(1, 2_500)], 50_000, 1_000);

    expect(before[0]?.capturedAtMs).toBe(50_000);
    expect(after[0]?.capturedAtMs).toBe(51_500);
  });

  it('rejects invalid benchmark clock anchors before provider work', () => {
    expect(() => rebaseTranscriptOperationalChunks([chunk(0, 100)], Number.NaN)).toThrow(
      'anchorMs must be a non-negative finite number',
    );
    expect(() => rebaseTranscriptOperationalChunks([chunk(0, -1)], 1_000)).toThrow(
      'fixture.capturedAtMs must be a non-negative finite number',
    );
  });
});
