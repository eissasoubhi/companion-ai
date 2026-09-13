import { createControlledDisconnectSocketFactory } from './benchmark-controlled-disconnect.js';
import type { AssemblyAIProviderConfig } from './providers/assemblyai.js';
import type { DeepgramProviderConfig } from './providers/deepgram.js';
import type { OpenAILiveTranscriptionConfig } from './providers/openai.js';

export interface ProviderDisconnectBenchmark<TConfig> {
  readonly config: TConfig;
  triggerDisconnect(): void;
}

export function createDeepgramDisconnectBenchmark(
  config: DeepgramProviderConfig,
): ProviderDisconnectBenchmark<DeepgramProviderConfig> {
  const harness = createControlledDisconnectSocketFactory(config.createSocket);
  return {
    config: { ...config, createSocket: harness.createSocket },
    triggerDisconnect: harness.triggerDisconnect,
  };
}

export function createAssemblyAIDisconnectBenchmark(
  config: AssemblyAIProviderConfig,
): ProviderDisconnectBenchmark<AssemblyAIProviderConfig> {
  const harness = createControlledDisconnectSocketFactory(config.createSocket);
  return {
    config: { ...config, createSocket: harness.createSocket },
    triggerDisconnect: harness.triggerDisconnect,
  };
}

export function createOpenAIDisconnectBenchmark(
  config: OpenAILiveTranscriptionConfig,
): ProviderDisconnectBenchmark<OpenAILiveTranscriptionConfig> {
  const harness = createControlledDisconnectSocketFactory(config.createSocket);
  return {
    config: { ...config, createSocket: harness.createSocket },
    triggerDisconnect: harness.triggerDisconnect,
  };
}
