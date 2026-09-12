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

  constructor(audioIpc: AudioIpcController) {
    this.#audioIpc = audioIpc;
  }

  activate(session: ActiveTranscriptionSession): void {
    if (this.#active) {
      throw new Error('A transcription session is already active.');
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
    if (!active) return;

    // Stop accepting new chunks before closing provider connections. In-flight
    // writes keep their captured sink reference and settle independently.
    this.#active = undefined;
    this.#audioIpc.setSink(undefined);
    await active.close();
  }

  get activeSessionId(): string | undefined {
    return this.#active?.sessionId;
  }
}
