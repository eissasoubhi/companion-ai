import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionConnection,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from '../types.js';

export interface DeepgramSocketMessage {
  readonly data: string | ArrayBuffer | Uint8Array;
}

export interface DeepgramSocketCloseEvent {
  readonly code?: number | undefined;
  readonly reason?: string | undefined;
}

export interface DeepgramSocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (event: DeepgramSocketMessage) => void): void;
  onError(handler: (error: unknown) => void): void;
  onClose(handler: (event: DeepgramSocketCloseEvent) => void): void;
}

/**
 * The composition root owns authentication. In production this factory should
 * create an authenticated socket with a short-lived token rather than expose a
 * long-lived Deepgram API key to renderer code.
 */
export type DeepgramSocketFactory = (url: string) => DeepgramSocket;

export interface DeepgramProviderConfig {
  readonly createSocket: DeepgramSocketFactory;
  readonly endpoint?: string | undefined;
  readonly model?: string | undefined;
  readonly language?: string | undefined;
  readonly endpointingMs?: number | undefined;
  readonly keyterms?: readonly string[] | undefined;
  readonly smartFormat?: boolean | undefined;
  readonly numerals?: boolean | undefined;
  readonly openTimeoutMs?: number | undefined;
}

interface DeepgramResultsMessage {
  readonly type: 'Results';
  readonly start?: number;
  readonly duration?: number;
  readonly is_final?: boolean;
  readonly speech_final?: boolean;
  readonly channel_index?: readonly number[];
  readonly channel?: {
    readonly alternatives?: readonly {
      readonly transcript?: string;
    }[];
  };
}

interface DeepgramErrorMessage {
  readonly type?: string;
  readonly err_code?: string;
  readonly err_msg?: string;
  readonly description?: string;
  readonly message?: string;
}

const DEFAULT_ENDPOINT = 'wss://api.eu.deepgram.com/v1/listen';
const DEFAULT_OPEN_TIMEOUT_MS = 8_000;

function encodeQuery(config: DeepgramProviderConfig, request: TranscriptionConnectRequest): string {
  const params = new URLSearchParams();
  params.set('model', config.model ?? 'nova-3');
  params.set('language', request.language ?? config.language ?? 'multi');
  params.set('interim_results', request.partialResults ? 'true' : 'false');
  params.set('endpointing', String(config.endpointingMs ?? 100));
  params.set('smart_format', String(config.smartFormat ?? true));
  params.set('numerals', String(config.numerals ?? true));

  for (const keyterm of config.keyterms ?? []) {
    const normalized = keyterm.trim();
    if (normalized) params.append('keyterm', normalized);
  }

  return params.toString();
}

function deepgramEncoding(chunk: AudioChunk): string {
  switch (chunk.encoding) {
    case 'pcm-s16le':
      return 'linear16';
    case 'opus':
      return 'opus';
    case 'pcm-f32le':
      throw new Error('Deepgram Nova-3 adapter does not support pcm-f32le raw audio.');
  }
}

function decodeText(data: DeepgramSocketMessage['data']): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  return null;
}

function isRetryableClose(code: number | undefined): boolean {
  if (code === undefined) return true;
  return code === 1006 || code === 1011 || code === 1012 || code === 1013;
}

function isRetryableProviderError(code: string): boolean {
  const normalized = code.toLowerCase();
  return !(
    normalized.includes('auth') ||
    normalized.includes('forbidden') ||
    normalized.includes('invalid') ||
    normalized.includes('bad_request')
  );
}

export class DeepgramNova3Provider implements TranscriptionProvider {
  readonly id = 'deepgram:nova-3';
  readonly #config: DeepgramProviderConfig;
  readonly #clock: () => number;

  constructor(config: DeepgramProviderConfig, clock: () => number = () => Date.now()) {
    this.#config = config;
    this.#clock = clock;
  }

  async connect(
    request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ): Promise<TranscriptionConnection> {
    const endpoint = this.#config.endpoint ?? DEFAULT_ENDPOINT;
    const baseUrl = `${endpoint}?${encodeQuery(this.#config, request)}`;
    const socket = this.#config.createSocket(baseUrl);
    const connectionStartedAtMs = this.#clock();
    const openTimeoutMs = this.#config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    let closed = false;
    let audioFormat: { encoding: string; sampleRateHz: number; channels: number } | undefined;

    const opened = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Deepgram WebSocket did not open within ${openTimeoutMs}ms.`));
        socket.close(1000, 'open-timeout');
      }, openTimeoutMs);

      socket.onOpen(() => {
        clearTimeout(timeout);
        onEvent({ type: 'ready' });
        resolve();
      });

      socket.onError((error) => {
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : 'Deepgram WebSocket error';
        reject(new Error(message));
      });
    });

    socket.onMessage((event) => {
      const raw = decodeText(event.data);
      if (!raw) return;

      let message: DeepgramResultsMessage | DeepgramErrorMessage;
      try {
        message = JSON.parse(raw) as DeepgramResultsMessage | DeepgramErrorMessage;
      } catch {
        onEvent({
          type: 'error',
          code: 'invalid-provider-message',
          message: 'Deepgram returned a non-JSON control message.',
          retryable: false,
        });
        return;
      }

      if (message.type === 'Results') {
        const transcript = message.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
        if (!transcript) return;

        const relativeStartMs = Math.max(0, (message.start ?? 0) * 1_000);
        const durationMs = Math.max(0, (message.duration ?? 0) * 1_000);
        const startedAtMs = connectionStartedAtMs + relativeStartMs;
        const endedAtMs = startedAtMs + durationMs;
        const channel = message.channel_index?.[0] ?? 0;
        const segmentStart = Math.round(relativeStartMs);

        onEvent({
          type: 'transcript',
          segmentId: `dg:${channel}:${segmentStart}`,
          text: transcript,
          isFinal: message.is_final === true,
          startedAtMs,
          endedAtMs,
        });
        return;
      }

      const errorCode = message.err_code ?? message.type ?? 'deepgram-error';
      const errorMessage =
        message.err_msg ?? message.description ?? message.message ?? 'Deepgram provider error';

      if (message.err_code || message.type === 'Error') {
        onEvent({
          type: 'error',
          code: errorCode,
          message: errorMessage,
          retryable: isRetryableProviderError(errorCode),
        });
      }
    });

    socket.onClose((event) => {
      if (closed) return;
      closed = true;

      if (event.code && event.code !== 1000) {
        onEvent({
          type: 'error',
          code: `websocket-close-${event.code}`,
          message: event.reason || 'Deepgram WebSocket closed unexpectedly.',
          retryable: isRetryableClose(event.code),
        });
      }

      onEvent({
        type: 'closed',
        ...(event.reason ? { reason: event.reason } : {}),
      });
    });

    await opened;

    return {
      write: async (chunk) => {
        const encoding = deepgramEncoding(chunk);
        const format = {
          encoding,
          sampleRateHz: chunk.sampleRateHz,
          channels: chunk.channels,
        };

        if (!audioFormat) {
          audioFormat = format;
        } else if (
          audioFormat.encoding !== format.encoding ||
          audioFormat.sampleRateHz !== format.sampleRateHz ||
          audioFormat.channels !== format.channels
        ) {
          throw new Error('Audio format changed during an active Deepgram stream.');
        }

        socket.send(chunk.data);
      },
      close: async () => {
        if (closed) return;
        socket.send(JSON.stringify({ type: 'Finalize' }));
        socket.send(JSON.stringify({ type: 'CloseStream' }));
        closed = true;
        socket.close(1000, 'client-close');
        onEvent({ type: 'closed', reason: 'client-close' });
      },
    };
  }
}

export function buildDeepgramListenUrl(
  request: TranscriptionConnectRequest,
  config: Omit<DeepgramProviderConfig, 'createSocket'>,
): string {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  return `${endpoint}?${encodeQuery(config as DeepgramProviderConfig, request)}`;
}
