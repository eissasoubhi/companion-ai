import { describe, expect, it, vi } from 'vitest';

import { startCaptureSession } from './capture-session.js';
import type {
  LiveAudioSource,
  LiveAudioStreamHandle,
  LiveAudioStreamOptions,
} from './live-audio-stream.js';

function createStream(label: string) {
  const stop = vi.fn();
  const track = { stop } as unknown as MediaStreamTrack;
  const stream = {
    id: label,
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, stop };
}

function createHandle(source: LiveAudioSource): LiveAudioStreamHandle {
  return {
    source,
    droppedFrames: () => 0,
    stop: vi.fn(async () => undefined),
  };
}

function createDependencies() {
  const local = createStream('local-stream');
  const remote = createStream('remote-stream');
  const localHandle = createHandle('local');
  const remoteHandle = createHandle('remote');
  const startLiveAudioStream = vi.fn(async (options: LiveAudioStreamOptions) =>
    options.source === 'local' ? localHandle : remoteHandle,
  );

  return {
    local,
    remote,
    localHandle,
    remoteHandle,
    dependencies: {
      getUserMedia: vi.fn(async () => local.stream),
      getDisplayMedia: vi.fn(async () => remote.stream),
      startTranscription: vi.fn(async () => ({ sessionId: 'session-1' })),
      stopTranscription: vi.fn(async () => undefined),
      startLiveAudioStream,
    },
  };
}

describe('startCaptureSession', () => {
  it('starts local and remote streaming with the same transcription session', async () => {
    const harness = createDependencies();

    const session = await startCaptureSession({ language: 'en' }, harness.dependencies);

    expect(harness.dependencies.startTranscription).toHaveBeenCalledWith({ language: 'en' });
    expect(harness.dependencies.startLiveAudioStream).toHaveBeenCalledTimes(2);
    expect(harness.dependencies.startLiveAudioStream.mock.calls[0]?.[0]).toMatchObject({
      stream: harness.local.stream,
      source: 'local',
      sessionId: 'session-1',
    });
    expect(harness.dependencies.startLiveAudioStream.mock.calls[1]?.[0]).toMatchObject({
      stream: harness.remote.stream,
      source: 'remote',
      sessionId: 'session-1',
    });
    expect(session.sessionId).toBe('session-1');

    await session.stop();
  });

  it('fails closed exactly once when either live channel degrades', async () => {
    const harness = createDependencies();
    const onDegraded = vi.fn();

    await startCaptureSession({ onDegraded }, harness.dependencies);

    const localOptions = harness.dependencies.startLiveAudioStream.mock.calls[0]?.[0];
    const remoteOptions = harness.dependencies.startLiveAudioStream.mock.calls[1]?.[0];
    localOptions?.onDegraded?.('track-ended');
    remoteOptions?.onDegraded?.('write-failed', new Error('saturated'));

    await vi.waitFor(() => {
      expect(harness.localHandle.stop).toHaveBeenCalledOnce();
      expect(harness.remoteHandle.stop).toHaveBeenCalledOnce();
      expect(harness.dependencies.stopTranscription).toHaveBeenCalledOnce();
    });
    expect(onDegraded).toHaveBeenCalledOnce();
    expect(onDegraded).toHaveBeenCalledWith('local', 'track-ended', undefined);
  });

  it('rejects startup and cleans up if a channel degrades before both channels are ready', async () => {
    const harness = createDependencies();
    const onDegraded = vi.fn();
    harness.dependencies.startLiveAudioStream.mockImplementationOnce(async (options) => {
      options.onDegraded?.('track-ended');
      return harness.localHandle;
    });
    harness.dependencies.startLiveAudioStream.mockImplementationOnce(async () => harness.remoteHandle);

    await expect(
      startCaptureSession({ onDegraded }, harness.dependencies),
    ).rejects.toThrow('Capture degraded during startup (local: track-ended)');

    expect(onDegraded).toHaveBeenCalledOnce();
    expect(harness.localHandle.stop).toHaveBeenCalledOnce();
    expect(harness.remoteHandle.stop).toHaveBeenCalledOnce();
    expect(harness.dependencies.stopTranscription).toHaveBeenCalledOnce();
  });

  it('cleans up an already-started local channel when remote setup fails', async () => {
    const harness = createDependencies();
    harness.dependencies.startLiveAudioStream.mockImplementationOnce(async () => harness.localHandle);
    harness.dependencies.startLiveAudioStream.mockImplementationOnce(async () => {
      throw new Error('remote setup failed');
    });

    await expect(startCaptureSession({}, harness.dependencies)).rejects.toThrow('remote setup failed');

    expect(harness.localHandle.stop).toHaveBeenCalledOnce();
    expect(harness.remote.stop).toHaveBeenCalledOnce();
    expect(harness.dependencies.stopTranscription).toHaveBeenCalledOnce();
  });

  it('releases raw capture when the system picker fails before transcription starts', async () => {
    const harness = createDependencies();
    harness.dependencies.getDisplayMedia.mockRejectedValueOnce(new Error('picker cancelled'));

    await expect(startCaptureSession({}, harness.dependencies)).rejects.toThrow('picker cancelled');

    expect(harness.local.stop).toHaveBeenCalledOnce();
    expect(harness.dependencies.startTranscription).not.toHaveBeenCalled();
    expect(harness.dependencies.stopTranscription).not.toHaveBeenCalled();
  });

  it('stops both sources and transcription exactly once across repeated stop calls', async () => {
    const harness = createDependencies();
    const session = await startCaptureSession({}, harness.dependencies);

    await Promise.all([session.stop(), session.stop()]);

    expect(harness.localHandle.stop).toHaveBeenCalledOnce();
    expect(harness.remoteHandle.stop).toHaveBeenCalledOnce();
    expect(harness.dependencies.stopTranscription).toHaveBeenCalledOnce();
  });
});
