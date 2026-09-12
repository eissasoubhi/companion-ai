import { ipcMain, type IpcMainInvokeEvent } from 'electron';

export type AudioIpcSource = 'local' | 'remote';

export interface AudioIpcChunk {
  readonly sessionId: string;
  readonly source: AudioIpcSource;
  readonly sequence: number;
  readonly capturedAtMs: number;
  readonly sampleRateHz: number;
  readonly channels: 1;
  readonly encoding: 'pcm-s16le';
  readonly data: Uint8Array;
}

export interface AudioIpcSink {
  writeAudio(chunk: AudioIpcChunk): Promise<void>;
}

export interface AudioIpcController {
  setSink(sink: AudioIpcSink | undefined): void;
  dispose(): void;
}

const CHANNEL = 'audio:write-chunk';
const MAX_CHUNK_BYTES = 64 * 1024;
const MAX_IN_FLIGHT_PER_SOURCE = 8;
const MIN_SAMPLE_RATE_HZ = 8_000;
const MAX_SAMPLE_RATE_HZ = 96_000;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Audio IPC payload must be an object.');
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new Error(`Invalid audio IPC ${field}.`);
  }
  return value;
}

function requireSafeInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`Invalid audio IPC ${field}.`);
  }
  return value as number;
}

function normalizeBinary(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error('Audio IPC data must be binary.');
}

export function parseAudioIpcChunk(value: unknown): AudioIpcChunk {
  const payload = asRecord(value);
  const sessionId = requireNonEmptyString(payload.sessionId, 'sessionId');
  const source = payload.source;
  if (source !== 'local' && source !== 'remote') {
    throw new Error('Invalid audio IPC source.');
  }

  const sequence = requireSafeInteger(payload.sequence, 'sequence');
  const capturedAtMs = payload.capturedAtMs;
  if (typeof capturedAtMs !== 'number' || !Number.isFinite(capturedAtMs) || capturedAtMs < 0) {
    throw new Error('Invalid audio IPC capturedAtMs.');
  }

  const sampleRateHz = requireSafeInteger(payload.sampleRateHz, 'sampleRateHz', MIN_SAMPLE_RATE_HZ);
  if (sampleRateHz > MAX_SAMPLE_RATE_HZ) {
    throw new Error('Invalid audio IPC sampleRateHz.');
  }
  if (payload.channels !== 1) {
    throw new Error('Audio IPC only accepts mono audio.');
  }
  if (payload.encoding !== 'pcm-s16le') {
    throw new Error('Audio IPC only accepts pcm-s16le.');
  }

  const data = normalizeBinary(payload.data);
  if (data.byteLength === 0 || data.byteLength > MAX_CHUNK_BYTES) {
    throw new Error('Audio IPC chunk size is outside allowed bounds.');
  }

  return {
    sessionId,
    source,
    sequence,
    capturedAtMs,
    sampleRateHz,
    channels: 1,
    encoding: 'pcm-s16le',
    data,
  };
}

export function registerAudioIpcHandlers(): AudioIpcController {
  let sink: AudioIpcSink | undefined;
  const inFlight: Record<AudioIpcSource, number> = { local: 0, remote: 0 };

  const handler = async (_event: IpcMainInvokeEvent, raw: unknown): Promise<void> => {
    const chunk = parseAudioIpcChunk(raw);
    const currentSink = sink;
    if (!currentSink) {
      throw new Error('Audio transcription ingress is not active.');
    }
    if (inFlight[chunk.source] >= MAX_IN_FLIGHT_PER_SOURCE) {
      throw new Error(`Audio ${chunk.source} ingress is saturated.`);
    }

    inFlight[chunk.source] += 1;
    try {
      await currentSink.writeAudio(chunk);
    } finally {
      inFlight[chunk.source] -= 1;
    }
  };

  ipcMain.handle(CHANNEL, handler);

  return {
    setSink(nextSink) {
      sink = nextSink;
    },
    dispose() {
      sink = undefined;
      ipcMain.removeHandler(CHANNEL);
    },
  };
}
