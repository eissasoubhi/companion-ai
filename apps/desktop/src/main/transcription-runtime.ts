import { randomUUID } from 'node:crypto';

import {
  DeepgramNova3Provider,
  TranscriptionSession,
  type DeepgramSocket,
  type TranscriptionPipelineEventHandler,
  type TranscriptionProvider,
} from '@companion-ai/transcription';

import type { TranscriptionIngress } from './transcription-ingress.js';

export interface StartTranscriptionOptions {
  readonly language?: string | undefined;
}

export interface TranscriptionRuntimeDependencies {
  readonly getApiKey: () => string | undefined;
  readonly createProvider: (apiKey: string) => TranscriptionProvider;
  readonly createSessionId: () => string;
}

function createNativeDeepgramSocket(url: string, apiKey: string): DeepgramSocket {
  const socket = new WebSocket(url, ['token', apiKey]);

  return {
    send: (data) =>
      socket.send(typeof data === 'string' ? data : Uint8Array.from(data).buffer),
    close: (code, reason) => socket.close(code, reason),
    onOpen: (handler) => socket.addEventListener('open', handler),
    onMessage: (handler) =>
      socket.addEventListener('message', (event) => {
        const data = event.data;
        if (typeof data === 'string' || data instanceof ArrayBuffer) {
          handler({ data });
          return;
        }
        if (data instanceof Uint8Array) handler({ data });
      }),
    onError: (handler) => socket.addEventListener('error', handler),
    onClose: (handler) =>
      socket.addEventListener('close', (event) =>
        handler({ code: event.code, reason: event.reason }),
      ),
  };
}

function createDefaultProvider(apiKey: string): TranscriptionProvider {
  return new DeepgramNova3Provider({
    createSocket: (url) => createNativeDeepgramSocket(url, apiKey),
    audioFormat: {
      encoding: 'pcm-s16le',
      sampleRateHz: 16_000,
      channels: 1,
    },
  });
}

const defaultDependencies: TranscriptionRuntimeDependencies = {
  getApiKey: () => process.env.DEEPGRAM_API_KEY?.trim() || undefined,
  createProvider: createDefaultProvider,
  createSessionId: randomUUID,
};

/** Owns the live STT session in Electron's main process. */
export class TranscriptionRuntime {
  readonly #ingress: TranscriptionIngress;
  readonly #emit: TranscriptionPipelineEventHandler;
  readonly #dependencies: TranscriptionRuntimeDependencies;
  #sessionId: string | undefined;
  #starting = false;
  #lifecycleVersion = 0;

  constructor(
    ingress: TranscriptionIngress,
    emit: TranscriptionPipelineEventHandler,
    dependencies: TranscriptionRuntimeDependencies = defaultDependencies,
  ) {
    this.#ingress = ingress;
    this.#emit = emit;
    this.#dependencies = dependencies;
  }

  async start(options: StartTranscriptionOptions = {}): Promise<{ sessionId: string }> {
    if (this.#sessionId || this.#starting) {
      throw new Error('A transcription session is already active or starting.');
    }

    const apiKey = this.#dependencies.getApiKey();
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY is required to start live transcription.');
    }

    this.#starting = true;
    const lifecycleVersion = ++this.#lifecycleVersion;
    const sessionId = this.#dependencies.createSessionId();
    let session: TranscriptionSession | undefined;

    try {
      session = await TranscriptionSession.open({
        sessionId,
        localProvider: this.#dependencies.createProvider(apiKey),
        remoteProvider: this.#dependencies.createProvider(apiKey),
        emit: this.#emit,
        partialResults: true,
        ...(options.language === undefined ? {} : { language: options.language }),
      });

      if (lifecycleVersion !== this.#lifecycleVersion) {
        await session.close();
        session = undefined;
        throw new Error('Transcription start was cancelled.');
      }

      this.#ingress.activate(session);
      this.#sessionId = sessionId;
      return { sessionId };
    } catch (error) {
      if (session) await session.close();
      throw error;
    } finally {
      this.#starting = false;
    }
  }

  async stop(): Promise<void> {
    ++this.#lifecycleVersion;
    this.#sessionId = undefined;
    await this.#ingress.deactivate();
  }

  get activeSessionId(): string | undefined {
    return this.#sessionId;
  }
}
