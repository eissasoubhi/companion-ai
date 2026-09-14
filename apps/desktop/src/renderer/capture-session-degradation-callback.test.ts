import { describe, expect, it, vi } from 'vitest';

import { startCaptureSession } from './capture-session.js';
import type { LiveAudioSource, LiveAudioStreamHandle, LiveAudioStreamOptions } from './live-audio-stream.js';

function createStream(): MediaStream {
  const track = { kind: 'audio', readyState: 'live', stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

function createHandle(source: LiveAudioSource): LiveAudioStreamHandle {
  return {
    source,
    droppedFrames: () => 0,
    stop: vi.fn(async () => undefined),
  };
}

describe('capture degradation callback isolation', () => {
  it('still fails closed when the diagnostics callback throws after startup', async () => {
    const localHandle = createHandle('local');
    const remoteHandle = createHandle('remote');
    const startLiveAudioStream = vi.fn(async (options: LiveAudioStreamOptions) =>
      options.source === 'local' ? localHandle : remoteHandle,
    );
    const stopTranscription = vi.fn(async () => undefined);
    const dependencies = {
      getUserMedia: vi.fn(async () => createStream()),
      getDisplayMedia: vi.fn(async () => createStream()),
      startTranscription: vi.fn(async () => ({ sessionId: 'session-1' })),
      stopTranscription,
      startLiveAudioStream,
      now: vi.fn(() => 0),
    };

    await startCaptureSession(
      {
        onDegraded: () => {
          throw new Error('diagnostics unavailable');
        },
      },
      dependencies,
    );

    startLiveAudioStream.mock.calls[0]?.[0].onDegraded?.('track-ended');

    await vi.waitFor(() => {
      expect(localHandle.stop).toHaveBeenCalledOnce();
      expect(remoteHandle.stop).toHaveBeenCalledOnce();
      expect(stopTranscription).toHaveBeenCalledOnce();
    });
  });

  it('still rejects startup if the diagnostics callback throws during early degradation', async () => {
    const localHandle = createHandle('local');
    const remoteHandle = createHandle('remote');
    const stopTranscription = vi.fn(async () => undefined);
    const startLiveAudioStream = vi.fn(async (options: LiveAudioStreamOptions) => {
      if (options.source === 'local') {
        options.onDegraded?.('track-ended');
        return localHandle;
      }
      return remoteHandle;
    });
    const dependencies = {
      getUserMedia: vi.fn(async () => createStream()),
      getDisplayMedia: vi.fn(async () => createStream()),
      startTranscription: vi.fn(async () => ({ sessionId: 'session-1' })),
      stopTranscription,
      startLiveAudioStream,
      now: vi.fn(() => 0),
    };

    await expect(
      startCaptureSession(
        {
          onDegraded: () => {
            throw new Error('diagnostics unavailable');
          },
        },
        dependencies,
      ),
    ).rejects.toThrow('Capture degraded during startup (local: track-ended)');

    expect(localHandle.stop).toHaveBeenCalledOnce();
    expect(remoteHandle.stop).toHaveBeenCalledOnce();
    expect(stopTranscription).toHaveBeenCalledOnce();
  });
});
