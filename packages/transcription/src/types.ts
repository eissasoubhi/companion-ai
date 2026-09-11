import type { AudioSource, TranscriptSegment } from '@companion-ai/contracts';

export type AudioEncoding = 'pcm-s16le' | 'pcm-f32le' | 'opus';

export interface AudioChunk {
  readonly sessionId: string;
  readonly source: AudioSource;
  readonly sequence: number;
  readonly capturedAtMs: number;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly encoding: AudioEncoding;
  readonly data: Uint8Array;
}

export interface TranscriptionConnectRequest {
  readonly sessionId: string;
  readonly source: AudioSource;
  readonly language?: string | undefined;
  readonly partialResults: boolean;
}

export interface ProviderTranscriptEvent {
  readonly type: 'transcript';
  readonly segmentId: string;
  readonly text: string;
  readonly isFinal: boolean;
  readonly startedAtMs: number;
  readonly endedAtMs?: number | undefined;
}

export interface ProviderReadyEvent {
  readonly type: 'ready';
}

export interface ProviderErrorEvent {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ProviderClosedEvent {
  readonly type: 'closed';
  readonly reason?: string | undefined;
}

export type TranscriptionProviderEvent =
  | ProviderTranscriptEvent
  | ProviderReadyEvent
  | ProviderErrorEvent
  | ProviderClosedEvent;

export interface TranscriptionConnection {
  /**
   * Resolves only when the adapter has accepted the chunk. Providers may use
   * this promise to apply backpressure rather than buffering without bounds.
   */
  write(chunk: AudioChunk): Promise<void>;
  close(): Promise<void>;
}

export type TranscriptionProviderEventHandler = (
  event: TranscriptionProviderEvent,
) => void;

export interface TranscriptionProvider {
  readonly id: string;
  connect(
    request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ): Promise<TranscriptionConnection>;
}

export interface TranscriptLatencySample {
  readonly providerId: string;
  readonly sessionId: string;
  readonly source: AudioSource;
  readonly segmentId: string;
  readonly isFinal: boolean;
  readonly observedAtMs: number;
  readonly audioEndedAtMs: number;
  readonly lagMs: number;
}

export type TranscriptionPipelineEvent =
  | {
      readonly type: 'transcript';
      readonly segment: TranscriptSegment;
      readonly latency: TranscriptLatencySample;
    }
  | {
      readonly type: 'provider-ready';
      readonly providerId: string;
      readonly sessionId: string;
      readonly source: AudioSource;
    }
  | {
      readonly type: 'provider-error';
      readonly providerId: string;
      readonly sessionId: string;
      readonly source: AudioSource;
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    }
  | {
      readonly type: 'provider-closed';
      readonly providerId: string;
      readonly sessionId: string;
      readonly source: AudioSource;
      readonly reason?: string | undefined;
    };

export type TranscriptionPipelineEventHandler = (
  event: TranscriptionPipelineEvent,
) => void;

export interface ReconnectPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const defaultReconnectPolicy: ReconnectPolicy = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
};
