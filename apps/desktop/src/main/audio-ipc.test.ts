import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handle, removeHandler } = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle, removeHandler },
}));

import { parseAudioIpcChunk, registerAudioIpcHandlers } from './audio-ipc.js';

function validChunk(source: 'local' | 'remote' = 'local') {
  return {
    sessionId: 'session-1',
    source,
    sequence: 0,
    capturedAtMs: 100,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: 'pcm-s16le',
    data: new Uint8Array([1, 2, 3, 4]),
  } as const;
}

describe('audio IPC ingress', () => {
  beforeEach(() => {
    handle.mockReset();
    removeHandler.mockReset();
  });

  it('accepts bounded mono PCM chunks without base64 conversion', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const parsed = parseAudioIpcChunk({ ...validChunk(), data });

    expect(parsed.data).toBe(data);
    expect(parsed.source).toBe('local');
    expect(parsed.encoding).toBe('pcm-s16le');
  });

  it.each([
    [{ ...validChunk(), source: 'unknown' }, 'source'],
    [{ ...validChunk(), channels: 2 }, 'mono'],
    [{ ...validChunk(), encoding: 'opus' }, 'pcm-s16le'],
    [{ ...validChunk(), data: new Uint8Array() }, 'size'],
    [{ ...validChunk(), data: new Uint8Array(64 * 1024 + 1) }, 'size'],
    [{ ...validChunk(), sequence: -1 }, 'sequence'],
    [{ ...validChunk(), sampleRateHz: 192_000 }, 'sampleRateHz'],
  ])('rejects malformed payloads', (payload, message) => {
    expect(() => parseAudioIpcChunk(payload)).toThrow(message);
  });

  it('rejects writes while no transcription sink is active', async () => {
    registerAudioIpcHandlers();
    expect(handle).toHaveBeenCalledOnce();
    const handler = handle.mock.calls[0]?.[1] as (_event: unknown, raw: unknown) => Promise<void>;

    await expect(handler({}, validChunk())).rejects.toThrow('not active');
  });

  it('keeps local and remote in-flight limits independent', async () => {
    const pending: Array<() => void> = [];
    const controller = registerAudioIpcHandlers();
    controller.setSink({
      writeAudio: () => new Promise<void>((resolve) => pending.push(resolve)),
    });
    const handler = handle.mock.calls[0]?.[1] as (_event: unknown, raw: unknown) => Promise<void>;

    const localWrites = Array.from({ length: 8 }, (_, sequence) =>
      handler({}, { ...validChunk('local'), sequence }),
    );
    await expect(handler({}, { ...validChunk('local'), sequence: 8 })).rejects.toThrow('saturated');

    const remoteWrite = handler({}, validChunk('remote'));
    expect(pending).toHaveLength(9);

    for (const resolve of pending) resolve();
    await Promise.all([...localWrites, remoteWrite]);
  });
});
