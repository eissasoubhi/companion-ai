import { describe, expect, it } from 'vitest';

import {
  createAssemblyAIOperationalScenarioExecutor,
  createDeepgramOperationalScenarioExecutor,
  createOpenAIOperationalScenarioExecutor,
  type TranscriptOperationalAudioFixtures,
} from './benchmark-provider-operational.js';
import type { AssemblyAIProviderConfig } from './providers/assemblyai.js';
import type { DeepgramProviderConfig } from './providers/deepgram.js';
import type { OpenAILiveTranscriptionConfig } from './providers/openai.js';

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
});
