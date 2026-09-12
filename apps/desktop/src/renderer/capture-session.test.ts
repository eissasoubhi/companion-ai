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
      now: vi.fn(() => 0),
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

  it('emits bounded startup timing for every successful stage', async () => {
    const harness = createDependencies();
    const onStartupMetric = vi.fn();
    const times = [10, 15, 20, 28, 30, 33, 40, 47, 50, 61];
    harness.dependencies.now.mockImplementation(() => times.shift() ?? 61);

    const session = await startCaptureSession({ onStartupMetric }, harness.dependencies);

    expect(onStartupMetric.mock.calls.map(([metric]) => metric)).toEqual([
      { stage: 'microphone-capture', durationMs: 5, outcome: 'success' },
      { stage: 'remote-capture', durationMs: 8, outcome: 'success' },
      { stage: 'transcription', durationMs: 3, outcome: 'success' },
      { stage: 'local-stream', durationMs: 7, outcome: 'success' },
      { stage: 'remote-stream', durationMs: 11, outcome: 'success' },
    ]);

    await session.stop();
  });

  it('records a failed startup stage and still cleans up acquired capture', async () => {
    const harness = createDependencies();
    const onStartupMetric = vi.fn();
    const times = [100, 104, 110, 119];
    harness.dependencies.now.mockImplementation(() => times.shift() ?? 119);
    harness.dependencies.getDisplayMedia.mockRejectedValueOnce(new Error('picker cancelled'));

    await expect(
      startCaptureSession({ onStartupMetric }, harness.dependencies),
    ).rejects.toThrow('picker cancelled');

    expect(onStartupMetric.mock.calls.map(([metric]) => metric)).toEqual([
      { stage: 'microphone-capture', durationMs: 4, outcome: 'success' },
      { stage: 'remote-capture', durationMs: 9, outcome: 'failure' },
    ]);
    expect(harness.local.stop).toHaveBeenCalledOnce();
  });

  it('does not let a diagnostics callback failure break capture startup', async () => {
    const harness = createDependencies();
    const onStartupMetric = vi.fn(() => {
      throw new Error('telemetry unavailable');
    });

    const session = await startCaptureSession({ onStartupMetric }, harness.dependencies);

    expect(onStartupMetric).toHaveBeenCalledTimes(5);
    expect(session.sessionId).toBe('session-1');
    await session.stop();
  });

  it('clamps invalid or negative timing values instead of exposing unsafe metrics', async () => {
    const harness = createDependencies();
    const onStartupMetric = vi.fn();
    const times = [10, 5, Number.NaN, 20, 30, 30, 40, 40, 50, 50];
    harness.dependencies.now.mockImplementation(() => times.shift() ?? 50);

    const session = await startCaptureSession({ onStartupMetric }, harness.dependencies);

    expect(onStartupMetric.mock.calls.map(([metric]) => metric.durationMs)).toEqual([0, 0, 0, 0, 0]);
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
