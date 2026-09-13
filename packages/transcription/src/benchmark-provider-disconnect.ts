import { createControlledDisconnectSocketFactory } from './benchmark-controlled-disconnect.js';
import type { AssemblyAIProviderConfig } from './providers/assemblyai.js';
import type { DeepgramProviderConfig } from './providers/deepgram.js';
import type { OpenAILiveTranscriptionConfig } from './providers/openai.js';

export interface ProviderDisconnectBenchmark<TConfig> {
  readonly config: TConfig;
  triggerDisconnect(): void;
}

function wrapConfig<TConfig extends { readonly createSocket: (...args: never[]) => { close(code?: number, reason?: string): void } }>(
  config: TConfig,
): ProviderDisconnectBenchmark<TConfig> {
  const harness = createControlledDisconnectSocketFactory(config.createSocket);
  return {
    config: { ...config, createSocket: harness.createSocket },
    triggerDisconnect: harness.triggerDisconnect,
  } as ProviderDisconnectBenchmark<TConfig>;
}

export function createDeepgramDisconnectBenchmark(
  config: DeepgramProviderConfig,
): ProviderDisconnectBenchmark<DeepgramProviderConfig> {
  return wrapConfig(config);
}

export function createAssemblyAIDisconnectBenchmark(
  config: AssemblyAIProviderConfig,
): ProviderDisconnectBenchmark<AssemblyAIProviderConfig> {
  return wrapConfig(config);
}

export function createOpenAIDisconnectBenchmark(
  config: OpenAILiveTranscriptionConfig,
): ProviderDisconnectBenchmark<OpenAILiveTranscriptionConfig> {
  return wrapConfig(config);
}
