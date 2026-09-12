import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionConnection,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from '../types.js';

export interface OpenAIRealtimeSocketMessage {
  readonly data: string | ArrayBuffer | Uint8Array;
}

export interface OpenAIRealtimeSocketCloseEvent {
  readonly code?: number | undefined;
  readonly reason?: string | undefined;
}

export interface OpenAIRealtimeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (event: OpenAIRealtimeSocketMessage) => void): void;
  onError(handler: (error: unknown) => void): void;
  onClose(handler: (event: OpenAIRealtimeSocketCloseEvent) => void): void;
}

/** Authentication is owned by the composition root; credentials never enter renderer code. */
export type OpenAIRealtimeSocketFactory = (url: string) => OpenAIRealtimeSocket;

export type OpenAITranscriptionDelay = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface OpenAILiveTranscriptionConfig {
  readonly createSocket: OpenAIRealtimeSocketFactory;
  readonly endpoint?: string | undefined;
  readonly model?: string | undefined;
  readonly sampleRateHz?: number | undefined;
  readonly prompt?: string | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly languages?: readonly string[] | undefined;
  readonly delay?: OpenAITranscriptionDelay | undefined;
  readonly vadThreshold?: number | undefined;
  readonly vadPrefixPaddingMs?: number | undefined;
  readonly vadSilenceDurationMs?: number | undefined;
  readonly openTimeoutMs?: number | undefined;
  readonly closeTimeoutMs?: number | undefined;
}

const DEFAULT_ENDPOINT = 'wss://api.openai.com/v1/realtime?model=gpt-live-transcribe';
const DEFAULT_MODEL = 'gpt-live-transcribe';
const DEFAULT_SAMPLE_RATE_HZ = 24_000;
const DEFAULT_OPEN_TIMEOUT_MS = 8_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface TranscriptState {
  text: string;
  startedAtMs: number;
}

function assertConfig(config: OpenAILiveTranscriptionConfig): void {
  const sampleRateHz = config.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError('OpenAI sample rate must be a positive number.');
  }

  const endpoint = new URL(config.endpoint ?? DEFAULT_ENDPOINT);
  if (endpoint.protocol !== 'wss:') {
    throw new Error('OpenAI realtime transcription endpoint must use WSS.');
  }
  for (const key of endpoint.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (normalized.includes('key') || normalized.includes('token') || normalized.includes('secret')) {
      throw new Error('OpenAI credentials must not be placed in the WebSocket URL.');
    }
  }

  const threshold = config.vadThreshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('OpenAI VAD threshold must be between 0 and 1.');
  }

  for (const keyword of config.keywords ?? []) {
    if (/[<>\r\n]/u.test(keyword)) {
      throw new Error('OpenAI transcription keywords cannot contain <, >, CR, or LF.');
    }
  }
}

function decodeText(data: OpenAIRealtimeSocketMessage['data']): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function retryableClose(code: number | undefined): boolean {
  return code === undefined || code === 1006 || code === 1011 || code === 1012 || code === 1013;
}

function retryableProviderError(code: string): boolean {
  const normalized = code.toLowerCase();
  return !(
    normalized.includes('auth') ||
    normalized.includes('permission') ||
    normalized.includes('invalid') ||
    normalized.includes('bad_request') ||
    normalized.includes('unsupported')
  );
}

function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    result += BASE64_ALPHABET[(triple >> 18) & 63];
    result += BASE64_ALPHABET[(triple >> 12) & 63];
    result += second === undefined ? '=' : BASE64_ALPHABET[(triple >> 6) & 63];
    result += third === undefined ? '=' : BASE64_ALPHABET[triple & 63];
  }
  return result;
}

function buildSessionUpdate(
  request: TranscriptionConnectRequest,
  config: OpenAILiveTranscriptionConfig,
): Record<string, unknown> {
  const languages = [
    ...(request.language ? [request.language] : []),
    ...(config.languages ?? []),
  ].map((language) => language.trim()).filter(Boolean);
  const keywords = (config.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean);

  return {
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: {
            type: 'audio/pcm',
            rate: config.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ,
          },
          transcription: {
            model: config.model ?? DEFAULT_MODEL,
            ...(config.prompt?.trim() ? { prompt: config.prompt.trim() } : {}),
            ...(keywords.length > 0 ? { keywords } : {}),
            ...(languages.length > 0 ? { languages: [...new Set(languages)] } : {}),
            delay: config.delay ?? 'low',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: config.vadThreshold ?? 0.5,
            prefix_padding_ms: config.vadPrefixPaddingMs ?? 300,
            silence_duration_ms: config.vadSilenceDurationMs ?? 500,
          },
        },
      },
    },
  };
}

function sameStream(chunk: AudioChunk, request: TranscriptionConnectRequest): boolean {
  return chunk.sessionId === request.sessionId && chunk.source === request.source;
}

export class OpenAIGptLiveTranscribeProvider implements TranscriptionProvider {
  readonly id = 'openai:gpt-live-transcribe';
  readonly #config: OpenAILiveTranscriptionConfig;
  readonly #clock: () => number;

  constructor(config: OpenAILiveTranscriptionConfig, clock: () => number = () => Date.now()) {
    assertConfig(config);
    this.#config = config;
    this.#clock = clock;
  }

  async connect(
    request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ): Promise<TranscriptionConnection> {
    const socket = this.#config.createSocket(this.#config.endpoint ?? DEFAULT_ENDPOINT);
    const sampleRateHz = this.#config.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
    const openTimeoutMs = this.#config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    const closeTimeoutMs = this.#config.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    const transcripts = new Map<string, TranscriptState>();
    let opened = false;
    let ready = false;
    let closed = false;
    let closeRequested = false;
    let openingSettled = false;
    let rejectOpening: ((error: Error) => void) | undefined;
    let resolveOpening: (() => void) | undefined;
    let resolveClosed: (() => void) | undefined;

    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const openingPromise = new Promise<void>((resolve, reject) => {
      resolveOpening = resolve;
      rejectOpening = reject;
    });

    const finishClosed = (reason?: string): void => {
      if (closed) return;
      closed = true;
      transcripts.clear();
      onEvent({ type: 'closed', ...(reason ? { reason } : {}) });
      resolveClosed?.();
    };

    const settleReady = (): void => {
      if (ready || openingSettled) return;
      ready = true;
      openingSettled = true;
      onEvent({ type: 'ready' });
      resolveOpening?.();
    };

    const openTimer = setTimeout(() => {
      if (openingSettled) return;
      openingSettled = true;
      rejectOpening?.(new Error(`OpenAI realtime transcription did not become ready within ${openTimeoutMs}ms.`));
      socket.close(1000, 'open-timeout');
    }, openTimeoutMs);

    socket.onOpen(() => {
      opened = true;
      socket.send(JSON.stringify(buildSessionUpdate(request, this.#config)));
    });

    socket.onMessage((event) => {
      if (closed) return;
      const raw = decodeText(event.data);
      if (!raw) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        onEvent({
          type: 'error',
          code: 'invalid-provider-message',
          message: 'OpenAI returned a non-JSON realtime control message.',
          retryable: false,
        });
        return;
      }
      if (!isRecord(parsed)) return;

      const type = nonEmptyString(parsed.type);
      if (type === 'session.updated') {
        clearTimeout(openTimer);
        settleReady();
        return;
      }

      if (type === 'conversation.item.input_audio_transcription.delta') {
        const itemId = nonEmptyString(parsed.item_id);
        const delta = typeof parsed.delta === 'string' ? parsed.delta : undefined;
        if (!itemId || delta === undefined) return;
        const contentIndex = finiteNumber(parsed.content_index) ?? 0;
        const key = `${itemId}:${contentIndex}`;
        const current = transcripts.get(key) ?? { text: '', startedAtMs: this.#clock() };
        current.text += delta;
        transcripts.set(key, current);
        const text = current.text.trim();
        if (request.partialResults && text) {
          onEvent({
            type: 'transcript',
            segmentId: `oa:${key}`,
            text,
            isFinal: false,
            startedAtMs: current.startedAtMs,
          });
        }
        return;
      }

      if (type === 'conversation.item.input_audio_transcription.completed') {
        const itemId = nonEmptyString(parsed.item_id);
        const transcript = typeof parsed.transcript === 'string' ? parsed.transcript.trim() : '';
        if (!itemId || !transcript) return;
        const contentIndex = finiteNumber(parsed.content_index) ?? 0;
        const key = `${itemId}:${contentIndex}`;
        const current = transcripts.get(key);
        const endedAtMs = this.#clock();
        onEvent({
          type: 'transcript',
          segmentId: `oa:${key}`,
          text: transcript,
          isFinal: true,
          startedAtMs: current?.startedAtMs ?? endedAtMs,
          endedAtMs,
        });
        transcripts.delete(key);
        return;
      }

      if (type === 'error') {
        const error = isRecord(parsed.error) ? parsed.error : parsed;
        const code = nonEmptyString(error.code) ?? 'openai-realtime-error';
        const message = nonEmptyString(error.message) ?? 'OpenAI realtime transcription error';
        const retryable = retryableProviderError(code);
        onEvent({ type: 'error', code, message, retryable });
        if (!ready && !openingSettled) {
          clearTimeout(openTimer);
          openingSettled = true;
          rejectOpening?.(new Error(message));
        }
      }
    });

    socket.onError((error) => {
      const message = error instanceof Error ? error.message : 'OpenAI realtime WebSocket error';
      if (!ready && !openingSettled) {
        clearTimeout(openTimer);
        openingSettled = true;
        rejectOpening?.(new Error(message));
        return;
      }
      if (!closed) {
        onEvent({ type: 'error', code: 'websocket-error', message, retryable: true });
      }
    });

    socket.onClose((event) => {
      clearTimeout(openTimer);
      if (!ready && !openingSettled) {
        openingSettled = true;
        rejectOpening?.(new Error(event.reason || 'OpenAI realtime WebSocket closed before readiness.'));
      }
      if (!closeRequested && ready && event.code !== 1000) {
        onEvent({
          type: 'error',
          code: `websocket-close-${event.code ?? 'unknown'}`,
          message: event.reason || 'OpenAI realtime WebSocket closed unexpectedly.',
          retryable: retryableClose(event.code),
        });
      }
      finishClosed(event.reason);
    });

    await openingPromise;

    return {
      write: async (chunk) => {
        if (!ready || closed || closeRequested) {
          throw new Error('OpenAI realtime transcription stream is not writable.');
        }
        if (!sameStream(chunk, request)) {
          throw new Error('Audio chunk does not belong to the active transcription stream.');
        }
        if (chunk.encoding !== 'pcm-s16le' || chunk.channels !== 1) {
          throw new Error('OpenAI realtime transcription requires mono pcm-s16le audio.');
        }
        if (chunk.sampleRateHz !== sampleRateHz) {
          throw new Error(`OpenAI realtime transcription expected ${sampleRateHz}Hz audio.`);
        }
        socket.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: encodeBase64(chunk.data),
        }));
      },
      close: async () => {
        if (closed || closeRequested) {
          await closedPromise;
          return;
        }
        closeRequested = true;
        socket.close(1000, 'client-close');

        let timeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          closedPromise,
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
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

export function buildOpenAITranscriptionSessionUpdate(
  request: TranscriptionConnectRequest,
  config: Omit<OpenAILiveTranscriptionConfig, 'createSocket'>,
): Record<string, unknown> {
  assertConfig({ ...config, createSocket: () => { throw new Error('unused'); } });
  return buildSessionUpdate(request, config as OpenAILiveTranscriptionConfig);
}
