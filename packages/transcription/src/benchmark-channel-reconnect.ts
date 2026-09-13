import type { TranscriptOperationalScenarioExecutor } from './benchmark-operational-runner.js';
import { TranscriptionChannel, type TranscriptionClock, type TranscriptionSleep } from './channel.js';
import type {
  ReconnectPolicy,
  TranscriptionConnectRequest,
  TranscriptionPipelineEvent,
  TranscriptionProvider,
} from './types.js';
import { defaultReconnectPolicy } from './types.js';

export interface TranscriptReconnectScenarioHarness {
  readonly provider: TranscriptionProvider;
  readonly request: TranscriptionConnectRequest;
  triggerDisconnect(): Promise<void> | void;
}

export interface TranscriptReconnectScenarioExecutorOptions {
  readonly providerId: string;
  readonly createScenario: (
    scenarioId: string,
  ) => Promise<TranscriptReconnectScenarioHarness> | TranscriptReconnectScenarioHarness;
  readonly timeoutMs?: number | undefined;
  readonly clock?: TranscriptionClock | undefined;
  readonly reconnectPolicy?: ReconnectPolicy | undefined;
  readonly sleep?: TranscriptionSleep | undefined;
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
    let unsubscribe = () => undefined;
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

export function createTranscriptChannelReconnectScenarioExecutor(
  options: TranscriptReconnectScenarioExecutorOptions,
): Pick<TranscriptOperationalScenarioExecutor, 'providerId' | 'measureReconnect'> {
  const providerId = requireCanonicalId(options.providerId, 'providerId');
  const timeoutMs = requirePositiveFinite(options.timeoutMs ?? 10_000, 'timeoutMs');
  const clock = options.clock ?? (() => Date.now());
  const reconnectPolicy = options.reconnectPolicy ?? defaultReconnectPolicy;

  return {
    providerId,
    async measureReconnect(scenarioId) {
      requireCanonicalId(scenarioId, 'scenarioId');
      const harness = await options.createScenario(scenarioId);
      const harnessProviderId = requireCanonicalId(harness.provider.id, 'harness.provider.id');
      if (harnessProviderId !== providerId) {
        throw new Error(
          `reconnect scenario provider mismatch: expected ${providerId}, received ${harnessProviderId}`,
        );
      }

      const listeners = new Set<(event: TranscriptionPipelineEvent) => void>();
      const subscribe = (listener: (event: TranscriptionPipelineEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      const emit = (event: TranscriptionPipelineEvent) => {
        for (const listener of [...listeners]) listener(event);
      };

      let channel: TranscriptionChannel | null = null;
      try {
        const initialReadyPromise = waitForReady(subscribe, timeoutMs);
        channel = await TranscriptionChannel.open(
          harness.provider,
          harness.request,
          emit,
          clock,
          reconnectPolicy,
          options.sleep,
        );
        if (!(await initialReadyPromise)) {
          throw new Error('transcription provider did not become ready before reconnect scenario');
        }

        const recoveryReadyPromise = waitForReady(subscribe, timeoutMs);
        const disconnectedAtMs = clock();
        if (!Number.isFinite(disconnectedAtMs) || disconnectedAtMs < 0) {
          throw new RangeError('clock must return a non-negative finite number');
        }

        await harness.triggerDisconnect();
        const recovered = await recoveryReadyPromise;
        const recoveredAtMs = recovered ? clock() : null;
        if (
          recoveredAtMs !== null &&
          (!Number.isFinite(recoveredAtMs) || recoveredAtMs < disconnectedAtMs)
        ) {
          throw new RangeError('recovery clock moved backwards');
        }

        return { disconnectedAtMs, recoveredAtMs };
      } finally {
        await channel?.close();
      }
    },
  };
}
