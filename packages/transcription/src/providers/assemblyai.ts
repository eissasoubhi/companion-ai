import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionConnection,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from '../types.js';

export interface AssemblyAISocketMessage {
  readonly data: string | ArrayBuffer | Uint8Array;
}

export interface AssemblyAISocketCloseEvent {
  readonly code?: number | undefined;
  readonly reason?: string | undefined;
}

export interface AssemblyAISocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (event: AssemblyAISocketMessage) => void): void;
  onError(handler: (error: unknown) => void): void;
  onClose(handler: (event: AssemblyAISocketCloseEvent) => void): void;
}

/** Authentication stays in the composition root; API keys never enter renderer code. */
export type AssemblyAISocketFactory = (url: string) => AssemblyAISocket;

export interface AssemblyAIProviderConfig {
  readonly createSocket: AssemblyAISocketFactory;
  readonly sampleRateHz: number;
  readonly endpoint?: string | undefined;
  readonly model?: string | undefined;
  readonly openTimeoutMs?: number | undefined;
  readonly closeTimeoutMs?: number | undefined;
  readonly continuousPartials?: boolean | undefined;
}

interface AssemblyAITurnMessage {
  readonly type: 'Turn';
  readonly transcript: string;
  readonly end_of_turn: boolean;
  readonly turn_order?: number | undefined;
}

const DEFAULT_ENDPOINT = 'wss://streaming.assemblyai.com/v3/ws';
const DEFAULT_MODEL = 'universal-3-5-pro';
const DEFAULT_OPEN_TIMEOUT_MS = 8_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;

function assertConfig(config: AssemblyAIProviderConfig): void {
  if (!Number.isFinite(config.sampleRateHz) || config.sampleRateHz <= 0) {
    throw new RangeError('AssemblyAI sample rate must be a positive number.');
  }
  const endpoint = new URL(config.endpoint ?? DEFAULT_ENDPOINT);
  if (endpoint.protocol !== 'wss:') {
    throw new Error('AssemblyAI streaming endpoint must use WSS.');
  }
}

function buildUrl(config: AssemblyAIProviderConfig, request: TranscriptionConnectRequest): string {
  assertConfig(config);
  const url = new URL(config.endpoint ?? DEFAULT_ENDPOINT);
  url.searchParams.set('sample_rate', String(config.sampleRateHz));
  url.searchParams.set('speech_model', config.model ?? DEFAULT_MODEL);
  url.searchParams.set('continuous_partials', String(config.continuousPartials ?? request.partialResults));
  return url.toString();
}

function decodeText(data: AssemblyAISocketMessage['data']): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  return null;
}

function parseTurn(value: unknown): AssemblyAITurnMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'Turn') return null;
  if (typeof record.transcript !== 'string' || typeof record.end_of_turn !== 'boolean') return null;
  const turnOrder =
    typeof record.turn_order === 'number' && Number.isFinite(record.turn_order)
      ? record.turn_order
      : undefined;
  return {
    type: 'Turn',
    transcript: record.transcript,
    end_of_turn: record.end_of_turn,
    ...(turnOrder === undefined ? {} : { turn_order: turnOrder }),
  };
}

function retryableClose(code: number | undefined): boolean {
  return code === undefined || code === 1006 || code === 1011 || code === 1012 || code === 1013;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AssemblyAIUniversal35Provider implements TranscriptionProvider {
  readonly id = 'assemblyai:universal-3-5-pro';
  readonly #config: AssemblyAIProviderConfig;
  readonly #clock: () => number;

  constructor(config: AssemblyAIProviderConfig, clock: () => number = () => Date.now()) {
    assertConfig(config);
    this.#config = config;
    this.#clock = clock;
  }

  async connect(
    request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ): Promise<TranscriptionConnection> {
    const socket = this.#config.createSocket(buildUrl(this.#config, request));
    const openTimeoutMs = this.#config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    const closeTimeoutMs = this.#config.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    let closed = false;
    let closeRequested = false;
    let turnSequence = 0;
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
      const timeout = setTimeout(() => {
        reject(new Error(`AssemblyAI WebSocket did not open within ${openTimeoutMs}ms.`));
        socket.close(1000, 'open-timeout');
      }, openTimeoutMs);

      socket.onOpen(() => {
        clearTimeout(timeout);
        onEvent({ type: 'ready' });
        resolve();
      });

      socket.onError((error) => {
        clearTimeout(timeout);
        const message = errorMessage(error);
        onEvent({ type: 'error', code: 'socket_error', message, retryable: true });
        reject(new Error(`AssemblyAI WebSocket failed to open: ${message}`));
      });
    });

    socket.onMessage((event) => {
      const text = decodeText(event.data);
      if (!text) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        onEvent({
          type: 'error',
          code: 'invalid_message',
          message: 'AssemblyAI returned invalid JSON.',
          retryable: false,
        });
        return;
      }

      const turn = parseTurn(parsed);
      if (!turn) return;
      const transcript = turn.transcript.trim();
      if (!transcript) return;

      const observedAtMs = this.#clock();
      const turnId = turn.turn_order ?? turnSequence++;
      onEvent({
        type: 'transcript',
        segmentId: `${request.sessionId}:${request.source}:turn-${turnId}`,
        text: transcript,
        isFinal: turn.end_of_turn,
        startedAtMs: observedAtMs,
        ...(turn.end_of_turn ? { endedAtMs: observedAtMs } : {}),
      });
    });

    socket.onClose((event) => {
      if (!closeRequested && retryableClose(event.code)) {
        onEvent({
          type: 'error',
          code: `socket_closed_${event.code ?? 'unknown'}`,
          message: event.reason || 'AssemblyAI WebSocket closed unexpectedly.',
          retryable: true,
        });
      }
      finishClosed(event.reason);
    });

    await opened;

    return {
      write: async (chunk: AudioChunk): Promise<void> => {
        if (closed || closeRequested) throw new Error('AssemblyAI connection is closed.');
        if (chunk.encoding !== 'pcm-s16le' || chunk.channels !== 1) {
          throw new Error('AssemblyAI adapter requires mono pcm-s16le audio.');
        }
        if (chunk.sampleRateHz !== this.#config.sampleRateHz) {
          throw new Error(
            `AssemblyAI adapter expected ${this.#config.sampleRateHz}Hz audio, received ${chunk.sampleRateHz}Hz.`,
          );
        }
        socket.send(chunk.data);
      },
      close: async (): Promise<void> => {
        if (closed) return;
        if (!closeRequested) {
          closeRequested = true;
          socket.send(JSON.stringify({ type: 'Terminate' }));
        }
        const timeout = new Promise<void>((resolve) => {
          setTimeout(() => {
            if (!closed) {
              socket.close(1000, 'close-timeout');
              finishClosed('close-timeout');
            }
            resolve();
          }, closeTimeoutMs);
        });
        await Promise.race([closedPromise, timeout]);
      },
    };
  }
}

export function buildAssemblyAIStreamingUrl(
  request: TranscriptionConnectRequest,
  config: AssemblyAIProviderConfig,
): string {
  return buildUrl(config, request);
}
