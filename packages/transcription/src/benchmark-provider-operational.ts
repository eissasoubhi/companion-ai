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
  readonly clock?: (() => number) | undefined;
}

function requirePositiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive finite number`);
  }
  return value;
}

function requireFiniteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative finite number`);
  }
  return value;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function rebaseTranscriptOperationalChunks(
  chunks: readonly AudioChunk[],
  anchorMs: number,
  originMs?: number,
): readonly AudioChunk[] {
  const normalizedAnchorMs = requireFiniteNonNegative(anchorMs, 'anchorMs');
  if (chunks.length === 0) return chunks;
  const first = chunks[0];
  if (!first) return chunks;
  const normalizedOriginMs = requireFiniteNonNegative(
    originMs ?? first.capturedAtMs,
    'fixture.capturedAtMs',
  );
  return chunks.map((chunk) => ({
    ...chunk,
    capturedAtMs:
      normalizedAnchorMs +
      (requireFiniteNonNegative(chunk.capturedAtMs, 'fixture.capturedAtMs') - normalizedOriginMs),
  }));
}

interface ProviderOperationalCompositionOptions {
  readonly providerId: string;
  readonly request: TranscriptionConnectRequest;
  readonly fixtures: TranscriptOperationalAudioFixtures;
  readonly timeoutMs?: number | undefined;
  readonly clock?: (() => number) | undefined;
  readonly createProvider: () => TranscriptionProvider;
  readonly reconnect: ReturnType<typeof createDeepgramReconnectScenarioExecutor>;
}

function composeProviderOperationalExecutor(options: ProviderOperationalCompositionOptions) {
  const pauseMs = requirePositiveFinite(
    options.fixtures.falseFinalization.pauseMs,
    'falseFinalization.pauseMs',
  );
  const clock = options.clock ?? Date.now;
  const sharedOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };

  return composeTranscriptOperationalScenarioExecutor({
    endpointFinalization: createTranscriptChannelEndpointFinalizationScenarioExecutor({
      ...sharedOptions,
      clock,
      providerId: options.providerId,
      createScenario: () => {
        const anchorMs = requireFiniteNonNegative(clock(), 'clock');
        const originalChunks = options.fixtures.endpointFinalization.chunks;
        const first = originalChunks[0];
        const originMs = first ? requireFiniteNonNegative(first.capturedAtMs, 'fixture.capturedAtMs') : 0;
        const originalAudioEndedAtMs = requireFiniteNonNegative(
          options.fixtures.endpointFinalization.audioEndedAtMs,
          'endpointFinalization.audioEndedAtMs',
        );
        if (originalAudioEndedAtMs < originMs) {
          throw new RangeError('endpointFinalization.audioEndedAtMs must not precede fixture audio');
        }
        return {
          provider: options.createProvider(),
          request: options.request,
          chunks: rebaseTranscriptOperationalChunks(originalChunks, anchorMs, originMs),
          audioEndedAtMs: anchorMs + (originalAudioEndedAtMs - originMs),
        };
      },
    }),
    reconnect: options.reconnect,
    falseFinalization: createTranscriptChannelFalseFinalizationScenarioExecutor({
      ...sharedOptions,
      providerId: options.providerId,
      createScenario: () => {
        const anchorMs = requireFiniteNonNegative(clock(), 'clock');
        const combined = [
          ...options.fixtures.falseFinalization.beforePauseChunks,
          ...options.fixtures.falseFinalization.afterPauseChunks,
        ];
        const first = combined[0];
        const originMs = first ? requireFiniteNonNegative(first.capturedAtMs, 'fixture.capturedAtMs') : 0;
        return {
          provider: options.createProvider(),
          request: options.request,
          beforePauseChunks: rebaseTranscriptOperationalChunks(
            options.fixtures.falseFinalization.beforePauseChunks,
            anchorMs,
            originMs,
          ),
          afterPauseChunks: rebaseTranscriptOperationalChunks(
            options.fixtures.falseFinalization.afterPauseChunks,
            anchorMs,
            originMs,
          ),
          waitDuringPause: () => wait(pauseMs),
        };
      },
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
    ...(options.clock === undefined ? {} : { clock: options.clock }),
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
    ...(options.clock === undefined ? {} : { clock: options.clock }),
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
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    providerId: 'openai:gpt-live-transcribe',
    request,
    fixtures,
    createProvider: () => new OpenAIGptLiveTranscribeProvider(config),
    reconnect: createOpenAIReconnectScenarioExecutor(config, request, sharedOptions),
  });
}
