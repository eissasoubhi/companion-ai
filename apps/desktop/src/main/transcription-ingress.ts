import type { TranscriptionSession } from '@companion-ai/transcription';

import type { AudioIpcChunk, AudioIpcController } from './audio-ipc.js';

type ActiveTranscriptionSession = Pick<
  TranscriptionSession,
  'sessionId' | 'writeAudio' | 'close'
>;

/**
 * Owns the handoff between the bounded renderer audio ingress and exactly one
 * active transcription session. The renderer only ever sees the narrow audio
 * IPC bridge; provider credentials and sockets remain in the main process.
 */
export class TranscriptionIngress {
  readonly #audioIpc: AudioIpcController;
  #active: ActiveTranscriptionSession | undefined;
  #closing = false;

  constructor(audioIpc: AudioIpcController) {
    this.#audioIpc = audioIpc;
  }

  activate(session: ActiveTranscriptionSession): void {
    if (this.#active || this.#closing) {
      throw new Error('A transcription session is already active or closing.');
    }

    this.#active = session;
    this.#audioIpc.setSink({
      writeAudio: async (chunk: AudioIpcChunk) => {
        const active = this.#active;
        if (!active || active !== session) {
          throw new Error('Transcription session is no longer active.');
        }
        if (chunk.sessionId !== session.sessionId) {
          throw new Error('Audio chunk does not belong to the active transcription session.');
        }
        await session.writeAudio(chunk);
      },
    });
  }

  async deactivate(): Promise<void> {
    const active = this.#active;
    if (!active || this.#closing) return;

    // Stop accepting new chunks before closing provider connections. In-flight
    // writes keep their captured sink reference and settle independently.
    this.#closing = true;
    this.#active = undefined;
    this.#audioIpc.setSink(undefined);
    try {
      await active.close();
    } finally {
      this.#closing = false;
    }
  }

  get activeSessionId(): string | undefined {
    return this.#active?.sessionId;
  }
}
