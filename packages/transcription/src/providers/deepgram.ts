import type {
  AudioChunk,
  AudioEncoding,
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

export interface DeepgramAudioFormat {
  readonly encoding: AudioEncoding;
  readonly sampleRateHz: number;
  readonly channels: number;
}

export interface DeepgramProviderConfig {
  readonly createSocket: DeepgramSocketFactory;
  readonly audioFormat: DeepgramAudioFormat;
  readonly endpoint?: string | undefined;
  readonly model?: string | undefined;
  readonly language?: string | undefined;
  readonly endpointingMs?: number | undefined;
  readonly keyterms?: readonly string[] | undefined;
  readonly smartFormat?: boolean | undefined;
  readonly numerals?: boolean | undefined;
  readonly openTimeoutMs?: number | undefined;
  readonly closeTimeoutMs?: number | undefined;
}

export type DeepgramListenOptions = Omit<DeepgramProviderConfig, 'createSocket'>;

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

const DEFAULT_ENDPOINT = 'wss://api.eu.deepgram.com/v1/listen';
const DEFAULT_OPEN_TIMEOUT_MS = 8_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;

function deepgramEncoding(encoding: AudioEncoding): string {
  switch (encoding) {
    case 'pcm-s16le':
      return 'linear16';
    case 'pcm-f32le':
      return 'linear32';
    case 'opus':
      return 'opus';
  }
}

function assertAudioFormat(format: DeepgramAudioFormat): void {
  if (!Number.isFinite(format.sampleRateHz) || format.sampleRateHz <= 0) {
    throw new RangeError('Deepgram sample rate must be a positive number.');
  }
  if (!Number.isInteger(format.channels) || format.channels <= 0) {
    throw new RangeError('Deepgram channel count must be a positive integer.');
  }
}

function encodeQuery(
  config: DeepgramListenOptions,
  request: TranscriptionConnectRequest,
): string {
  assertAudioFormat(config.audioFormat);
  const params = new URLSearchParams();
  params.set('model', config.model ?? 'nova-3');
  params.set('language', request.language ?? config.language ?? 'multi');
  params.set('encoding', deepgramEncoding(config.audioFormat.encoding));
  params.set('sample_rate', String(config.audioFormat.sampleRateHz));
  params.set('channels', String(config.audioFormat.channels));
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

function decodeText(data: DeepgramSocketMessage['data']): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isDeepgramResultsMessage(value: unknown): value is DeepgramResultsMessage {
  if (!isRecord(value) || value.type !== 'Results') return false;
  if (value.channel !== undefined && !isRecord(value.channel)) return false;
  return true;
}

function transcriptFromResults(message: DeepgramResultsMessage): string {
  const alternatives = message.channel?.alternatives;
  if (!Array.isArray(alternatives) || !isRecord(alternatives[0])) return '';
  return optionalString(alternatives[0].transcript)?.trim() ?? '';
}

function parseResultsMessage(value: unknown): DeepgramResultsMessage | null {
  if (!isDeepgramResultsMessage(value)) return null;

  const start = optionalNumber(value.start);
  const duration = optionalNumber(value.duration);
  const isFinal = optionalBoolean(value.is_final);
  const speechFinal = optionalBoolean(value.speech_final);
  const channel = isRecord(value.channel) ? value.channel : undefined;
  const rawAlternatives = Array.isArray(channel?.alternatives) ? channel.alternatives : undefined;
  const transcript =
    rawAlternatives && isRecord(rawAlternatives[0])
      ? optionalString(rawAlternatives[0].transcript)
      : undefined;
  const rawChannelIndex = Array.isArray(value.channel_index) ? value.channel_index : undefined;
  const channelIndex = rawChannelIndex?.filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item),
  );

  return {
    type: 'Results',
    ...(start === undefined ? {} : { start }),
    ...(duration === undefined ? {} : { duration }),
    ...(isFinal === undefined ? {} : { is_final: isFinal }),
    ...(speechFinal === undefined ? {} : { speech_final: speechFinal }),
    ...(channelIndex === undefined ? {} : { channel_index: channelIndex }),
    ...(transcript === undefined ? {} : { channel: { alternatives: [{ transcript }] } }),
  };
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

function sameAudioFormat(chunk: AudioChunk, format: DeepgramAudioFormat): boolean {
  return (
    chunk.encoding === format.encoding &&
    chunk.sampleRateHz === format.sampleRateHz &&
    chunk.channels === format.channels
  );
}

export class DeepgramNova3Provider implements TranscriptionProvider {
  readonly id = 'deepgram:nova-3';
  readonly #config: DeepgramProviderConfig;
  readonly #clock: () => number;

  constructor(config: DeepgramProviderConfig, clock: () => number = () => Date.now()) {
    assertAudioFormat(config.audioFormat);
    this.#config = config;
    this.#clock = clock;
  }

  async connect(
    request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ): Promise<TranscriptionConnection> {
    const url = buildDeepgramListenUrl(request, this.#config);
    const socket = this.#config.createSocket(url);
    const connectionStartedAtMs = this.#clock();
    const openTimeoutMs = this.#config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    const closeTimeoutMs = this.#config.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    let streamOriginMs = connectionStartedAtMs;
    let hasWrittenAudio = false;
    let closed = false;
    let closeRequested = false;
    let openedSuccessfully = false;
    let terminalProviderFailure = false;
    let rejectOpening: ((error: Error) => void) | undefined;
    let resolveClosed: (() => void) | undefined;

    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const finishClosed = (reason?: string): void => {
      if (closed) return;
      closed = true;
      onEvent({ type: 'closed', ...(reason ? { reason } : {}) });
      resolveClosed?.();
    };

    const opened = new Promise<void>((resolve, reject) => {
      rejectOpening = reject;
      const timeout = setTimeout(() => {
        reject(new Error(`Deepgram WebSocket did not open within ${openTimeoutMs}ms.`));
        socket.close(1000, 'open-timeout');
      }, openTimeoutMs);

      socket.onOpen(() => {
        clearTimeout(timeout);
        openedSuccessfully = true;
        onEvent({ type: 'ready' });
        resolve();
      });

      socket.onError((error) => {
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : 'Deepgram WebSocket error';
        if (!openedSuccessfully) {
          reject(new Error(message));
          return;
        }
        if (closed || terminalProviderFailure) return;
        onEvent({
          type: 'error',
          code: 'websocket-error',
          message,
          retryable: true,
        });
      });
    });

    socket.onMessage((event) => {
      if (closed) return;
      const raw = decodeText(event.data);
      if (!raw) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        terminalProviderFailure = true;
        onEvent({
          type: 'error',
          code: 'invalid-provider-message',
          message: 'Deepgram returned a non-JSON control message.',
          retryable: false,
        });
        return;
      }

      const results = parseResultsMessage(parsed);
      if (results) {
        const transcript = transcriptFromResults(results);
        if (!transcript) return;

        const relativeStartMs = Math.max(0, (results.start ?? 0) * 1_000);
        const durationMs = Math.max(0, (results.duration ?? 0) * 1_000);
        const startedAtMs = streamOriginMs + relativeStartMs;
        const endedAtMs = startedAtMs + durationMs;
        const channel = results.channel_index?.[0] ?? 0;
        const segmentStart = Math.round(relativeStartMs);

        onEvent({
          type: 'transcript',
          segmentId: `dg:${channel}:${segmentStart}`,
          text: transcript,
          isFinal: results.is_final === true,
          startedAtMs,
          endedAtMs,
        });
        return;
      }

      if (!isRecord(parsed)) return;
      const errorCode =
        optionalString(parsed.err_code) ?? optionalString(parsed.type) ?? 'deepgram-error';
      const errorMessage =
        optionalString(parsed.err_msg) ??
        optionalString(parsed.description) ??
        optionalString(parsed.message) ??
        'Deepgram provider error';
      const isError = parsed.err_code !== undefined || parsed.type === 'Error';

      if (isError) {
        const retryable = isRetryableProviderError(errorCode);
        if (!retryable) terminalProviderFailure = true;
        onEvent({
          type: 'error',
          code: errorCode,
          message: errorMessage,
          retryable,
        });
      }
    });

    socket.onClose((event) => {
      if (!openedSuccessfully) {
        rejectOpening?.(
          new Error(event.reason || 'Deepgram WebSocket closed before it became ready.'),
        );
      }

      if (!closeRequested && !terminalProviderFailure && event.code && event.code !== 1000) {
        onEvent({
          type: 'error',
          code: `websocket-close-${event.code}`,
          message: event.reason || 'Deepgram WebSocket closed unexpectedly.',
          retryable: isRetryableClose(event.code),
        });
      }
      finishClosed(event.reason);
    });

    await opened;

    return {
      write: async (chunk) => {
        if (closed || closeRequested || terminalProviderFailure) {
          throw new Error('Deepgram stream is not writable.');
        }
        if (chunk.sessionId !== request.sessionId || chunk.source !== request.source) {
          throw new Error('Audio chunk does not belong to the active transcription stream.');
        }
        if (!sameAudioFormat(chunk, this.#config.audioFormat)) {
          throw new Error('Audio chunk format does not match the active Deepgram stream.');
        }
        if (!hasWrittenAudio) {
          streamOriginMs = chunk.capturedAtMs;
          hasWrittenAudio = true;
        }
        socket.send(chunk.data);
      },
      close: async () => {
        if (closed || closeRequested) {
          await closedPromise;
          return;
        }

        closeRequested = true;
        socket.send(JSON.stringify({ type: 'Finalize' }));
        socket.send(JSON.stringify({ type: 'CloseStream' }));

        let timeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          closedPromise,
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
              socket.close(1000, 'client-close-timeout');
              finishClosed('client-close-timeout');
              resolve();
            }, closeTimeoutMs);
          }),
        ]);
        if (timeout) clearTimeout(timeout);
      },
    };
  }
}

export function buildDeepgramListenUrl(
  request: TranscriptionConnectRequest,
  config: DeepgramListenOptions,
): string {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  return `${endpoint}?${encodeQuery(config, request)}`;
}
