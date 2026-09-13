import { createTranscriptChannelReconnectScenarioExecutor } from './benchmark-channel-reconnect.js';
import {
  createAssemblyAIDisconnectBenchmark,
  createDeepgramDisconnectBenchmark,
  createOpenAIDisconnectBenchmark,
} from './benchmark-provider-disconnect.js';
import {
  AssemblyAIUniversal35Provider,
  type AssemblyAIProviderConfig,
} from './providers/assemblyai.js';
import { DeepgramNova3Provider, type DeepgramProviderConfig } from './providers/deepgram.js';
import {
  OpenAIGptLiveTranscribeProvider,
  type OpenAILiveTranscriptionConfig,
} from './providers/openai.js';
import type { TranscriptionConnectRequest } from './types.js';
import type { TranscriptReconnectScenarioExecutorOptions } from './benchmark-channel-reconnect.js';

type SharedReconnectOptions = Omit<
  TranscriptReconnectScenarioExecutorOptions,
  'providerId' | 'createScenario'
>;

export function createDeepgramReconnectScenarioExecutor(
  config: DeepgramProviderConfig,
  request: TranscriptionConnectRequest,
  options: SharedReconnectOptions = {},
) {
  return createTranscriptChannelReconnectScenarioExecutor({
    ...options,
    providerId: 'deepgram:nova-3',
    createScenario: () => {
      const benchmark = createDeepgramDisconnectBenchmark(config);
      return {
        provider: new DeepgramNova3Provider(benchmark.config, options.clock),
        request,
        triggerDisconnect: benchmark.triggerDisconnect,
      };
    },
  });
}

export function createAssemblyAIReconnectScenarioExecutor(
  config: AssemblyAIProviderConfig,
  request: TranscriptionConnectRequest,
  options: SharedReconnectOptions = {},
) {
  return createTranscriptChannelReconnectScenarioExecutor({
    ...options,
    providerId: 'assemblyai:universal-3-5-pro',
    createScenario: () => {
      const benchmark = createAssemblyAIDisconnectBenchmark(config);
      return {
        provider: new AssemblyAIUniversal35Provider(benchmark.config, options.clock),
        request,
        triggerDisconnect: benchmark.triggerDisconnect,
      };
    },
  });
}

export function createOpenAIReconnectScenarioExecutor(
  config: OpenAILiveTranscriptionConfig,
  request: TranscriptionConnectRequest,
  options: SharedReconnectOptions = {},
) {
  return createTranscriptChannelReconnectScenarioExecutor({
    ...options,
    providerId: 'openai:gpt-live-transcribe',
    createScenario: () => {
      const benchmark = createOpenAIDisconnectBenchmark(config);
      return {
        provider: new OpenAIGptLiveTranscribeProvider(benchmark.config, options.clock),
        request,
        triggerDisconnect: benchmark.triggerDisconnect,
      };
    },
  });
}
