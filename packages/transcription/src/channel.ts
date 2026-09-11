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

  #connection: TranscriptionConnection;
  #emit: TranscriptionPipelineEventHandler;
  #clock: TranscriptionClock;
  #lastSequence = -1;
  #closed = false;

  private constructor(
    provider: TranscriptionProvider,
    request: TranscriptionConnectRequest,
    connection: TranscriptionConnection,
    emit: TranscriptionPipelineEventHandler,
    clock: TranscriptionClock,
  ) {
    this.providerId = provider.id;
    this.sessionId = request.sessionId;
    this.source = request.source;
    this.#connection = connection;
    this.#emit = emit;
    this.#clock = clock;
  }

  static async open(
    provider: TranscriptionProvider,
    request: TranscriptionConnectRequest,
    emit: TranscriptionPipelineEventHandler,
    clock: TranscriptionClock = () => Date.now(),
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
    );

    forwardEvent = (event) => channel.#handleProviderEvent(event);
    for (const event of pendingEvents) channel.#handleProviderEvent(event);

    return channel;
  }

  async writeAudio(chunk: AudioChunk): Promise<void> {
    if (this.#closed) {
      throw new Error('Cannot write audio to a closed transcription channel.');
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

    await this.#connection.write(chunk);
    this.#lastSequence = chunk.sequence;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#connection.close();
  }

  #handleProviderEvent(event: TranscriptionProviderEvent): void {
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
