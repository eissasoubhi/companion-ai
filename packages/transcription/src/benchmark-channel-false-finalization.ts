import type { TranscriptOperationalScenarioExecutor } from './benchmark-operational-runner.js';
import { TranscriptionChannel } from './channel.js';
import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionPipelineEvent,
  TranscriptionProvider,
} from './types.js';

export interface TranscriptFalseFinalizationScenarioHarness {
  readonly provider: TranscriptionProvider;
  readonly request: TranscriptionConnectRequest;
  readonly beforePauseChunks: readonly AudioChunk[];
  readonly afterPauseChunks: readonly AudioChunk[];
  /**
   * Keeps the stream open while the benchmark simulates a natural pause.
   * Live harnesses should resolve only after the intended pause duration.
   */
  waitDuringPause(): Promise<void>;
}

export interface TranscriptFalseFinalizationScenarioExecutorOptions {
  readonly providerId: string;
  readonly createScenario: (
    scenarioId: string,
  ) => Promise<TranscriptFalseFinalizationScenarioHarness> | TranscriptFalseFinalizationScenarioHarness;
  readonly timeoutMs?: number | undefined;
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

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('natural-pause benchmark timed out')), timeoutMs);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createTranscriptChannelFalseFinalizationScenarioExecutor(
  options: TranscriptFalseFinalizationScenarioExecutorOptions,
): Pick<TranscriptOperationalScenarioExecutor, 'providerId' | 'measureFalseFinalization'> {
  const providerId = requireCanonicalId(options.providerId, 'providerId');
  const timeoutMs = requirePositiveFinite(options.timeoutMs ?? 10_000, 'timeoutMs');

  return {
    providerId,
    async measureFalseFinalization(scenarioId) {
      requireCanonicalId(scenarioId, 'scenarioId');
      const harness = await options.createScenario(scenarioId);
      const harnessProviderId = requireCanonicalId(harness.provider.id, 'harness.provider.id');
      if (harnessProviderId !== providerId) {
        throw new Error(
          `false-finalization scenario provider mismatch: expected ${providerId}, received ${harnessProviderId}`,
        );
      }
      if (harness.beforePauseChunks.length === 0 || harness.afterPauseChunks.length === 0) {
        throw new Error(
          'false-finalization scenario requires audio before and after the natural pause',
        );
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
      let monitoringPause = false;
      let falselyFinalized = false;
      const unsubscribe = subscribe((event) => {
        if (monitoringPause && event.type === 'transcript' && event.segment.isFinal) {
          falselyFinalized = true;
        }
      });

      try {
        const initialReadyPromise = waitForReady(subscribe, timeoutMs);
        channel = await TranscriptionChannel.open(harness.provider, harness.request, emit);
        if (!(await initialReadyPromise)) {
          throw new Error(
            'transcription provider did not become ready before false-finalization scenario',
          );
        }

        for (const chunk of harness.beforePauseChunks) {
          await channel.writeAudio(chunk);
        }

        monitoringPause = true;
        await withTimeout(harness.waitDuringPause(), timeoutMs);
        monitoringPause = false;

        for (const chunk of harness.afterPauseChunks) {
          await channel.writeAudio(chunk);
        }

        return { falselyFinalized };
      } finally {
        monitoringPause = false;
        unsubscribe();
        await channel?.close();
      }
    },
  };
}
