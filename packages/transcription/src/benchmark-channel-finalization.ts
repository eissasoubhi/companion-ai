import type { TranscriptOperationalScenarioExecutor } from './benchmark-operational-runner.js';
import { TranscriptionChannel, type TranscriptionClock } from './channel.js';
import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionPipelineEvent,
  TranscriptionProvider,
} from './types.js';

export interface TranscriptEndpointFinalizationScenarioHarness {
  readonly provider: TranscriptionProvider;
  readonly request: TranscriptionConnectRequest;
  readonly chunks: readonly AudioChunk[];
  /** End of the benchmark utterance on the same clock used by transcript events. */
  readonly audioEndedAtMs: number;
}

export interface TranscriptEndpointFinalizationScenarioExecutorOptions {
  readonly providerId: string;
  readonly createScenario: (
    scenarioId: string,
  ) =>
    | Promise<TranscriptEndpointFinalizationScenarioHarness>
    | TranscriptEndpointFinalizationScenarioHarness;
  readonly timeoutMs?: number | undefined;
  readonly clock?: TranscriptionClock | undefined;
}

function requireCanonicalId(value: string, field: string): string {
  if (value.length === 0) throw new Error(`${field} must not be empty`);
  if (value.trim() !== value) throw new Error(`${field} must be canonical`);
  return value;
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

function waitForReady(
  subscribe: (listener: (event: TranscriptionPipelineEvent) => void) => () => void,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: () => void = () => undefined;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      resolve(ready);
    };
    unsubscribe = subscribe((event) => {
      if (event.type === 'provider-ready') finish(true);
      if (event.type === 'provider-closed') finish(false);
    });
    if (!settled) timer = setTimeout(() => finish(false), timeoutMs);
  });
}

function waitForFinalTranscript(
  subscribe: (listener: (event: TranscriptionPipelineEvent) => void) => () => void,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: () => void = () => undefined;
    const finish = (observedAtMs: number | null) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      resolve(observedAtMs);
    };
    unsubscribe = subscribe((event) => {
      if (event.type === 'transcript' && event.segment.isFinal) {
        finish(event.latency.observedAtMs);
      } else if (event.type === 'provider-closed') {
        finish(null);
      }
    });
    if (!settled) timer = setTimeout(() => finish(null), timeoutMs);
  });
}

export function createTranscriptChannelEndpointFinalizationScenarioExecutor(
  options: TranscriptEndpointFinalizationScenarioExecutorOptions,
): Pick<TranscriptOperationalScenarioExecutor, 'providerId' | 'measureEndpointFinalization'> {
  const providerId = requireCanonicalId(options.providerId, 'providerId');
  const timeoutMs = requirePositiveFinite(options.timeoutMs ?? 10_000, 'timeoutMs');
  const clock = options.clock ?? (() => Date.now());

  return {
    providerId,
    async measureEndpointFinalization(scenarioId) {
      requireCanonicalId(scenarioId, 'scenarioId');
      const harness = await options.createScenario(scenarioId);
      const harnessProviderId = requireCanonicalId(harness.provider.id, 'harness.provider.id');
      if (harnessProviderId !== providerId) {
        throw new Error(
          `endpoint-finalization scenario provider mismatch: expected ${providerId}, received ${harnessProviderId}`,
        );
      }
      if (harness.chunks.length === 0) {
        throw new Error('endpoint-finalization scenario requires at least one audio chunk');
      }

      const audioEndedAtMs = requireFiniteNonNegative(
        harness.audioEndedAtMs,
        'audioEndedAtMs',
      );
      for (const chunk of harness.chunks) {
        if (chunk.capturedAtMs > audioEndedAtMs) {
          throw new RangeError('audioEndedAtMs must not be before an audio chunk capture time');
        }
      }

      const listeners = new Set<(event: TranscriptionPipelineEvent) => void>();
      const subscribe = (listener: (event: TranscriptionPipelineEvent) => void): (() => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      };
      const emit = (event: TranscriptionPipelineEvent) => {
        for (const listener of [...listeners]) listener(event);
      };

      let channel: TranscriptionChannel | null = null;
      try {
        const initialReadyPromise = waitForReady(subscribe, timeoutMs);
        channel = await TranscriptionChannel.open(harness.provider, harness.request, emit, clock);
        if (!(await initialReadyPromise)) {
          throw new Error(
            'transcription provider did not become ready before endpoint-finalization scenario',
          );
        }

        for (const chunk of harness.chunks) {
          await channel.writeAudio(chunk);
        }

        const finalTranscriptPromise = waitForFinalTranscript(subscribe, timeoutMs);
        const closePromise = channel.close();
        const finalTranscriptObservedAtMs = await finalTranscriptPromise;
        await closePromise;

        if (finalTranscriptObservedAtMs === null) {
          throw new Error('transcription provider closed without a final transcript');
        }
        if (finalTranscriptObservedAtMs < audioEndedAtMs) {
          throw new RangeError('final transcript was observed before benchmark audio ended');
        }

        return { audioEndedAtMs, finalTranscriptObservedAtMs };
      } finally {
        await channel?.close();
      }
    },
  };
}
