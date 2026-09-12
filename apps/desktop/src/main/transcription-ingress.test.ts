import { describe, expect, it, vi } from 'vitest';

import type { AudioIpcChunk, AudioIpcSink } from './audio-ipc.js';
import { TranscriptionIngress } from './transcription-ingress.js';

function chunk(sessionId = 'session-1', source: 'local' | 'remote' = 'local'): AudioIpcChunk {
  return {
    sessionId,
    source,
    sequence: 0,
    capturedAtMs: 100,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: 'pcm-s16le',
    data: new Uint8Array([1, 2, 3, 4]),
  };
}

function harness() {
  let sink: AudioIpcSink | undefined;
  const setSink = vi.fn((next: AudioIpcSink | undefined) => {
    sink = next;
  });
  const ingress = new TranscriptionIngress({ setSink, dispose: vi.fn() });
  return { ingress, setSink, getSink: () => sink };
}

describe('TranscriptionIngress', () => {
  it('routes local and remote chunks to the active transcription session', async () => {
    const { ingress, getSink } = harness();
    const writeAudio = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);

    ingress.activate({ sessionId: 'session-1', writeAudio, close });

    await getSink()?.writeAudio(chunk('session-1', 'local'));
    await getSink()?.writeAudio(chunk('session-1', 'remote'));

    expect(writeAudio).toHaveBeenCalledTimes(2);
    expect(writeAudio.mock.calls[0]?.[0].source).toBe('local');
    expect(writeAudio.mock.calls[1]?.[0].source).toBe('remote');
  });

  it('rejects chunks from a different session before provider write', async () => {
    const { ingress, getSink } = harness();
    const writeAudio = vi.fn(async () => undefined);

    ingress.activate({
      sessionId: 'session-1',
      writeAudio,
      close: vi.fn(async () => undefined),
    });

    await expect(getSink()?.writeAudio(chunk('stale-session'))).rejects.toThrow(
      'active transcription session',
    );
    expect(writeAudio).not.toHaveBeenCalled();
  });

  it('prevents replacing an active session without explicit teardown', () => {
    const { ingress } = harness();
    const session = {
      sessionId: 'session-1',
      writeAudio: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    ingress.activate(session);
    expect(() => ingress.activate({ ...session, sessionId: 'session-2' })).toThrow(
      'already active',
    );
  });

  it('removes the sink before closing the active session', async () => {
    const { ingress, setSink, getSink } = harness();
    const close = vi.fn(async () => {
      expect(getSink()).toBeUndefined();
    });

    ingress.activate({
      sessionId: 'session-1',
      writeAudio: vi.fn(async () => undefined),
      close,
    });
    await ingress.deactivate();

    expect(setSink).toHaveBeenLastCalledWith(undefined);
    expect(close).toHaveBeenCalledOnce();
    expect(ingress.activeSessionId).toBeUndefined();
  });

  it('rejects a write captured from an old sink after deactivation', async () => {
    const { ingress, getSink } = harness();
    const writeAudio = vi.fn(async () => undefined);

    ingress.activate({
      sessionId: 'session-1',
      writeAudio,
      close: vi.fn(async () => undefined),
    });
    const oldSink = getSink();
    await ingress.deactivate();

    await expect(oldSink?.writeAudio(chunk())).rejects.toThrow('no longer active');
    expect(writeAudio).not.toHaveBeenCalled();
  });
});
