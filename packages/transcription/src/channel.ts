import type { TranscriptSegment } from '@companion-ai/contracts';

import type {
  AudioChunk,
  ReconnectPolicy,
  TranscriptionConnectRequest,
  TranscriptionConnection,
  TranscriptionPipelineEvent,
  TranscriptionPipelineEventHandler,
  TranscriptionProvider,
  TranscriptionProviderEvent,
} from './types.js';
import { defaultReconnectPolicy } from './types.js';

export type TranscriptionClock = () => number;
export type TranscriptionSleep = (delayMs: number) => Promise<void>;

const defaultSleep: TranscriptionSleep = async (delayMs) => {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

export function reconnectDelayMs(
  attempt: number,
  policy: ReconnectPolicy = defaultReconnectPolicy,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError('Reconnect attempt must be a positive integer.');
  }

  const exponentialDelay = policy.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(exponentialDelay, policy.maxDelayMs);
}

export function shouldReconnect(
  retryable: boolean,
  completedAttempts: number,
  policy: ReconnectPolicy = defaultReconnectPolicy,
): boolean {
  return retryable && completedAttempts < policy.maxAttempts;
}

export class TranscriptionChannel {
  readonly providerId: string;
  readonly sessionId: string;
  readonly source: TranscriptionConnectRequest['source'];

  #provider: TranscriptionProvider;
  #request: TranscriptionConnectRequest;
  #connection: TranscriptionConnection;
  #emit: TranscriptionPipelineEventHandler;
  #clock: TranscriptionClock;
  #sleep: TranscriptionSleep;
  #reconnectPolicy: ReconnectPolicy;
  #lastSequence = -1;
  #closed = false;
  #writeInFlight = false;
  #generation = 0;
  #reconnectPromise: Promise<void> | null = null;

  private constructor(
    provider: TranscriptionProvider,
    request: TranscriptionConnectRequest,
    connection: TranscriptionConnection,
    emit: TranscriptionPipelineEventHandler,
    clock: TranscriptionClock,
    reconnectPolicy: ReconnectPolicy,
    sleep: TranscriptionSleep,
  ) {
    this.providerId = provider.id;
    this.sessionId = request.sessionId;
    this.source = request.source;
    this.#provider = provider;
    this.#request = request;
    this.#connection = connection;
    this.#emit = emit;
    this.#clock = clock;
    this.#reconnectPolicy = reconnectPolicy;
    this.#sleep = sleep;
  }

  static async open(
    provider: TranscriptionProvider,
    request: TranscriptionConnectRequest,
    emit: TranscriptionPipelineEventHandler,
    clock: TranscriptionClock = () => Date.now(),
    reconnectPolicy: ReconnectPolicy = defaultReconnectPolicy,
    sleep: TranscriptionSleep = defaultSleep,
  ): Promise<TranscriptionChannel> {
    const pendingEvents: TranscriptionProviderEvent[] = [];
    let forwardEvent: (event: TranscriptionProviderEvent) => void = (event) => {
      pendingEvents.push(event);
    };

    const connection = await provider.connect(request, (event) => forwardEvent(event));
    const channel = new TranscriptionChannel(
      provider,
      request,
      connection,
      emit,
      clock,
      reconnectPolicy,
      sleep,
    );

    forwardEvent = (event) => channel.#handleProviderEvent(event, 0);
    for (const event of pendingEvents) channel.#handleProviderEvent(event, 0);

    return channel;
  }

  async writeAudio(chunk: AudioChunk): Promise<void> {
    if (this.#closed) {
      throw new Error('Cannot write audio to a closed transcription channel.');
    }

    if (this.#reconnectPromise !== null) {
      throw new Error(
        'Cannot write audio while the transcription provider is reconnecting. Retry after provider-ready.',
      );
    }

    if (this.#writeInFlight) {
      throw new Error(
        'A transcription write is already in flight. Await writeAudio() to apply backpressure.',
      );
    }

    if (chunk.sessionId !== this.sessionId || chunk.source !== this.source) {
      throw new Error('Audio chunk does not belong to this transcription channel.');
    }

    if (!Number.isInteger(chunk.sequence) || chunk.sequence <= this.#lastSequence) {
      throw new RangeError('Audio chunk sequence must increase monotonically.');
    }

    if (
      chunk.data.byteLength === 0 ||
      !Number.isFinite(chunk.sampleRateHz) ||
      chunk.sampleRateHz <= 0 ||
      !Number.isInteger(chunk.channels) ||
      chunk.channels <= 0
    ) {
      throw new RangeError('Audio chunk format is invalid.');
    }

    this.#writeInFlight = true;
    try {
      await this.#connection.write(chunk);
      this.#lastSequence = chunk.sequence;
    } finally {
      this.#writeInFlight = false;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation += 1;
    await this.#connection.close();
  }

  #beginReconnect(): void {
    if (this.#closed || this.#reconnectPromise !== null) return;

    const reconnectPromise = this.#reconnect();
    this.#reconnectPromise = reconnectPromise;
    const clear = () => {
      if (this.#reconnectPromise === reconnectPromise) {
        this.#reconnectPromise = null;
      }
    };
    void reconnectPromise.then(clear, clear);
  }

  async #reconnect(): Promise<void> {
    const generation = this.#generation + 1;
    this.#generation = generation;

    try {
      await this.#connection.close();
    } catch {
      // The connection already failed. Reconnect is still worth attempting.
    }

    let completedAttempts = 0;
    while (shouldReconnect(true, completedAttempts, this.#reconnectPolicy)) {
      const attempt = completedAttempts + 1;
      await this.#sleep(reconnectDelayMs(attempt, this.#reconnectPolicy));
      if (this.#closed || generation !== this.#generation) return;

      const pendingEvents: TranscriptionProviderEvent[] = [];
      let forwardEvent: (event: TranscriptionProviderEvent) => void = (event) => {
        pendingEvents.push(event);
      };

      try {
        const connection = await this.#provider.connect(
          this.#request,
          (event) => forwardEvent(event),
        );
        if (this.#closed || generation !== this.#generation) {
          await connection.close();
          return;
        }

        this.#connection = connection;
        forwardEvent = (event) => this.#handleProviderEvent(event, generation);
        for (const event of pendingEvents) {
          this.#handleProviderEvent(event, generation);
        }
        return;
      } catch (error) {
        completedAttempts = attempt;
        const retryable = shouldReconnect(
          true,
          completedAttempts,
          this.#reconnectPolicy,
        );
        this.#emit({
          type: 'provider-error',
          providerId: this.providerId,
          sessionId: this.sessionId,
          source: this.source,
          code: 'reconnect-connect-failed',
          message: error instanceof Error ? error.message : 'Provider reconnect failed.',
          retryable,
        });
      }
    }

    if (!this.#closed && generation === this.#generation) {
      this.#closed = true;
      this.#emit({
        type: 'provider-closed',
        providerId: this.providerId,
        sessionId: this.sessionId,
        source: this.source,
        reason: 'reconnect-attempts-exhausted',
      });
    }
  }

  #handleProviderEvent(event: TranscriptionProviderEvent, generation: number): void {
    if (this.#closed || generation !== this.#generation) return;

    switch (event.type) {
      case 'ready':
        this.#emit({
          type: 'provider-ready',
          providerId: this.providerId,
          sessionId: this.sessionId,
          source: this.source,
        });
        return;

      case 'error':
        this.#emit({
          type: 'provider-error',
          providerId: this.providerId,
          sessionId: this.sessionId,
          source: this.source,
          code: event.code,
          message: event.message,
          retryable: event.retryable,
        });
        if (event.retryable) this.#beginReconnect();
        return;

      case 'closed':
        this.#emit({
          type: 'provider-closed',
          providerId: this.providerId,
          sessionId: this.sessionId,
          source: this.source,
          ...(event.reason === undefined ? {} : { reason: event.reason }),
        });
        return;

      case 'transcript': {
        const text = event.text.trim();
        if (!text) return;

        const observedAtMs = this.#clock();
        const audioEndedAtMs = event.endedAtMs ?? event.startedAtMs;
        const segment: TranscriptSegment = {
          id: `${this.sessionId}:${this.source}:${event.segmentId}`,
          sessionId: this.sessionId,
          source: this.source,
          text,
          isFinal: event.isFinal,
          startedAtMs: event.startedAtMs,
          ...(event.endedAtMs === undefined ? {} : { endedAtMs: event.endedAtMs }),
        };
        const pipelineEvent: TranscriptionPipelineEvent = {
          type: 'transcript',
          segment,
          latency: {
            providerId: this.providerId,
            sessionId: this.sessionId,
            source: this.source,
            segmentId: segment.id,
            isFinal: event.isFinal,
            observedAtMs,
            audioEndedAtMs,
            lagMs: Math.max(0, observedAtMs - audioEndedAtMs),
          },
        };

        this.#emit(pipelineEvent);
      }
    }
  }
}
