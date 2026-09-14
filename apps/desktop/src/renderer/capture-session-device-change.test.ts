import { describe, expect, it, vi } from 'vitest';

import { startCaptureSession } from './capture-session.js';
import type {
  LiveAudioSource,
  LiveAudioStreamHandle,
  LiveAudioStreamOptions,
} from './live-audio-stream.js';

function createMutableStream(label: string) {
  let readyState: MediaStreamTrackState = 'live';
  const stop = vi.fn(() => {
    readyState = 'ended';
  });
  const track = {
    kind: 'audio',
    get readyState() {
      return readyState;
    },
    stop,
  } as unknown as MediaStreamTrack;
  const stream = {
    id: label,
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;

  return {
    stream,
    stop,
    end: () => {
      readyState = 'ended';
    },
  };
}

function createHandle(source: LiveAudioSource): LiveAudioStreamHandle {
  return {
    source,
    droppedFrames: () => 0,
    stop: vi.fn(async () => undefined),
  };
}

function createHarness() {
  const local = createMutableStream('local');
  const remote = createMutableStream('remote');
  const localHandle = createHandle('local');
  const remoteHandle = createHandle('remote');
  let deviceChangeListener: (() => void) | undefined;
  const unsubscribe = vi.fn(() => {
    deviceChangeListener = undefined;
  });

  const dependencies = {
    getUserMedia: vi.fn(async () => local.stream),
    getDisplayMedia: vi.fn(async () => remote.stream),
    startTranscription: vi.fn(async () => ({ sessionId: 'session-device-change' })),
    stopTranscription: vi.fn(async () => undefined),
    startLiveAudioStream: vi.fn(async (options: LiveAudioStreamOptions) =>
      options.source === 'local' ? localHandle : remoteHandle,
    ),
    subscribeDeviceChange: vi.fn((listener: () => void) => {
      deviceChangeListener = listener;
      return unsubscribe;
    }),
    now: vi.fn(() => 0),
  };

  return {
    local,
    remote,
    localHandle,
    remoteHandle,
    dependencies,
    unsubscribe,
    emitDeviceChange: () => deviceChangeListener?.(),
  };
}

describe('capture session device changes', () => {
  it('keeps running when a device-change event does not invalidate either active audio track', async () => {
    const harness = createHarness();
    const onDegraded = vi.fn();
    const session = await startCaptureSession({ onDegraded }, harness.dependencies);

    harness.emitDeviceChange();
    await Promise.resolve();

    expect(onDegraded).not.toHaveBeenCalled();
    expect(harness.localHandle.stop).not.toHaveBeenCalled();
    expect(harness.remoteHandle.stop).not.toHaveBeenCalled();
    expect(harness.dependencies.stopTranscription).not.toHaveBeenCalled();

    await session.stop();
  });

  it('fails closed when the active local microphone track disappears', async () => {
    const harness = createHarness();
    const onDegraded = vi.fn();
    await startCaptureSession({ onDegraded }, harness.dependencies);

    harness.local.end();
    harness.emitDeviceChange();

    await vi.waitFor(() => {
      expect(harness.localHandle.stop).toHaveBeenCalledOnce();
      expect(harness.remoteHandle.stop).toHaveBeenCalledOnce();
      expect(harness.dependencies.stopTranscription).toHaveBeenCalledOnce();
    });
    expect(onDegraded).toHaveBeenCalledWith('local', 'device-change', undefined);
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it('fails closed and preserves remote attribution when the system-audio track disappears', async () => {
    const harness = createHarness();
    const onDegraded = vi.fn();
    await startCaptureSession({ onDegraded }, harness.dependencies);

    harness.remote.end();
    harness.emitDeviceChange();

    await vi.waitFor(() => {
      expect(harness.dependencies.stopTranscription).toHaveBeenCalledOnce();
    });
    expect(onDegraded).toHaveBeenCalledWith('remote', 'device-change', undefined);
  });

  it('removes the device-change listener during an explicit stop', async () => {
    const harness = createHarness();
    const onDegraded = vi.fn();
    const session = await startCaptureSession({ onDegraded }, harness.dependencies);

    await session.stop();
    harness.local.end();
    harness.emitDeviceChange();

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(onDegraded).not.toHaveBeenCalled();
    expect(harness.dependencies.stopTranscription).toHaveBeenCalledOnce();
  });

  it('cleans acquired raw streams if device-change subscription setup throws', async () => {
    const harness = createHarness();
    harness.dependencies.subscribeDeviceChange.mockImplementationOnce(() => {
      throw new Error('device observer unavailable');
    });

    await expect(startCaptureSession({}, harness.dependencies)).rejects.toThrow(
      'device observer unavailable',
    );

    expect(harness.local.stop).toHaveBeenCalledOnce();
    expect(harness.remote.stop).toHaveBeenCalledOnce();
    expect(harness.dependencies.startTranscription).not.toHaveBeenCalled();
  });
});
