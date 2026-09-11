import { TranscriptionChannel, type TranscriptionClock } from './channel.js';
import type {
  AudioChunk,
  TranscriptionPipelineEventHandler,
  TranscriptionProvider,
} from './types.js';

export interface TranscriptionSessionOptions {
  readonly sessionId: string;
  readonly localProvider: TranscriptionProvider;
  readonly remoteProvider: TranscriptionProvider;
  readonly emit: TranscriptionPipelineEventHandler;
  readonly language?: string | undefined;
  readonly partialResults?: boolean | undefined;
  readonly clock?: TranscriptionClock | undefined;
}

/**
 * Owns two independent STT channels for one meeting session. Audio is routed
 * strictly by source so microphone and system audio can never be mixed by the
 * orchestration layer.
 */
export class TranscriptionSession {
  readonly sessionId: string;
  readonly #local: TranscriptionChannel;
  readonly #remote: TranscriptionChannel;
  #closed = false;

  private constructor(
    sessionId: string,
    local: TranscriptionChannel,
    remote: TranscriptionChannel,
  ) {
    this.sessionId = sessionId;
    this.#local = local;
    this.#remote = remote;
  }

  static async open(options: TranscriptionSessionOptions): Promise<TranscriptionSession> {
    const partialResults = options.partialResults ?? true;
    const requestBase = {
      sessionId: options.sessionId,
      partialResults,
      ...(options.language === undefined ? {} : { language: options.language }),
    };

    const [localResult, remoteResult] = await Promise.allSettled([
      TranscriptionChannel.open(
        options.localProvider,
        { ...requestBase, source: 'local' },
        options.emit,
        options.clock,
      ),
      TranscriptionChannel.open(
        options.remoteProvider,
        { ...requestBase, source: 'remote' },
        options.emit,
        options.clock,
      ),
    ]);

    if (localResult.status === 'rejected') {
      if (remoteResult.status === 'fulfilled') {
        await Promise.allSettled([remoteResult.value.close()]);
      }
      throw localResult.reason;
    }

    if (remoteResult.status === 'rejected') {
      await Promise.allSettled([localResult.value.close()]);
      throw remoteResult.reason;
    }

    return new TranscriptionSession(options.sessionId, localResult.value, remoteResult.value);
  }

  async writeAudio(chunk: AudioChunk): Promise<void> {
    if (this.#closed) throw new Error('Cannot write audio to a closed transcription session.');
    if (chunk.sessionId !== this.sessionId) {
      throw new Error('Audio chunk does not belong to this transcription session.');
    }
    if (chunk.source !== 'local' && chunk.source !== 'remote') {
      throw new Error('Transcription session only accepts local or remote audio sources.');
    }

    const channel = chunk.source === 'local' ? this.#local : this.#remote;
    await channel.writeAudio(chunk);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled([this.#local.close(), this.#remote.close()]);
  }
}
