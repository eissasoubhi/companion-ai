import { createTranscriptChannelEndpointFinalizationScenarioExecutor } from './benchmark-channel-finalization.js';
import { createTranscriptChannelFalseFinalizationScenarioExecutor } from './benchmark-channel-false-finalization.js';
import { composeTranscriptOperationalScenarioExecutor } from './benchmark-operational-executor.js';
import {
  createAssemblyAIReconnectScenarioExecutor,
  createDeepgramReconnectScenarioExecutor,
  createOpenAIReconnectScenarioExecutor,
} from './benchmark-provider-reconnect.js';
import {
  AssemblyAIUniversal35Provider,
  type AssemblyAIProviderConfig,
} from './providers/assemblyai.js';
import { DeepgramNova3Provider, type DeepgramProviderConfig } from './providers/deepgram.js';
import {
  OpenAIGptLiveTranscribeProvider,
  type OpenAILiveTranscriptionConfig,
} from './providers/openai.js';
import type { AudioChunk, TranscriptionConnectRequest, TranscriptionProvider } from './types.js';

export interface TranscriptOperationalAudioFixtures {
  readonly endpointFinalization: {
    readonly chunks: readonly AudioChunk[];
    readonly audioEndedAtMs: number;
  };
  readonly falseFinalization: {
    readonly beforePauseChunks: readonly AudioChunk[];
    readonly afterPauseChunks: readonly AudioChunk[];
    readonly pauseMs: number;
  };
}

export interface ProviderOperationalScenarioOptions {
  readonly timeoutMs?: number | undefined;
}

function requirePositiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive finite number`);
  }
  return value;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ProviderOperationalCompositionOptions {
  readonly providerId: string;
  readonly request: TranscriptionConnectRequest;
  readonly fixtures: TranscriptOperationalAudioFixtures;
  readonly timeoutMs?: number | undefined;
  readonly createProvider: () => TranscriptionProvider;
  readonly reconnect: ReturnType<typeof createDeepgramReconnectScenarioExecutor>;
}

function composeProviderOperationalExecutor(options: ProviderOperationalCompositionOptions) {
  const pauseMs = requirePositiveFinite(
    options.fixtures.falseFinalization.pauseMs,
    'falseFinalization.pauseMs',
  );
  const sharedOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };

  return composeTranscriptOperationalScenarioExecutor({
    endpointFinalization: createTranscriptChannelEndpointFinalizationScenarioExecutor({
      ...sharedOptions,
      providerId: options.providerId,
      createScenario: () => ({
        provider: options.createProvider(),
        request: options.request,
        chunks: options.fixtures.endpointFinalization.chunks,
        audioEndedAtMs: options.fixtures.endpointFinalization.audioEndedAtMs,
      }),
    }),
    reconnect: options.reconnect,
    falseFinalization: createTranscriptChannelFalseFinalizationScenarioExecutor({
      ...sharedOptions,
      providerId: options.providerId,
      createScenario: () => ({
        provider: options.createProvider(),
        request: options.request,
        beforePauseChunks: options.fixtures.falseFinalization.beforePauseChunks,
        afterPauseChunks: options.fixtures.falseFinalization.afterPauseChunks,
        waitDuringPause: () => wait(pauseMs),
      }),
    }),
  });
}

export function createDeepgramOperationalScenarioExecutor(
  config: DeepgramProviderConfig,
  request: TranscriptionConnectRequest,
  fixtures: TranscriptOperationalAudioFixtures,
  options: ProviderOperationalScenarioOptions = {},
) {
  const sharedOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  return composeProviderOperationalExecutor({
    ...sharedOptions,
    providerId: 'deepgram:nova-3',
    request,
    fixtures,
    createProvider: () => new DeepgramNova3Provider(config),
    reconnect: createDeepgramReconnectScenarioExecutor(config, request, sharedOptions),
  });
}

export function createAssemblyAIOperationalScenarioExecutor(
  config: AssemblyAIProviderConfig,
  request: TranscriptionConnectRequest,
  fixtures: TranscriptOperationalAudioFixtures,
  options: ProviderOperationalScenarioOptions = {},
) {
  const sharedOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  return composeProviderOperationalExecutor({
    ...sharedOptions,
    providerId: 'assemblyai:universal-3-5-pro',
    request,
    fixtures,
    createProvider: () => new AssemblyAIUniversal35Provider(config),
    reconnect: createAssemblyAIReconnectScenarioExecutor(config, request, sharedOptions),
  });
}

export function createOpenAIOperationalScenarioExecutor(
  config: OpenAILiveTranscriptionConfig,
  request: TranscriptionConnectRequest,
  fixtures: TranscriptOperationalAudioFixtures,
  options: ProviderOperationalScenarioOptions = {},
) {
  const sharedOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  return composeProviderOperationalExecutor({
    ...sharedOptions,
    providerId: 'openai:gpt-live-transcribe',
    request,
    fixtures,
    createProvider: () => new OpenAIGptLiveTranscribeProvider(config),
    reconnect: createOpenAIReconnectScenarioExecutor(config, request, sharedOptions),
  });
}
