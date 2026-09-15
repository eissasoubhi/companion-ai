import { describe, expect, it, vi } from 'vitest';

import { startCaptureSession } from './capture-session.js';
import type { LiveAudioStreamHandle } from './live-audio-stream.js';

function track(stop: () => void, readyState: MediaStreamTrackState = 'live'): MediaStreamTrack {
  return { kind: 'audio', readyState, stop } as unknown as MediaStreamTrack;
}

function stream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((candidate) => candidate.kind === 'audio'),
  } as unknown as MediaStream;
}

function handle(source: 'local' | 'remote'): LiveAudioStreamHandle {
  return { source, droppedFrames: () => 0, stop: vi.fn(async () => undefined) };
}

describe('capture session raw stream cleanup', () => {
  it('attempts every raw track cleanup even when an earlier track stop throws', async () => {
    const firstStop = vi.fn(() => { throw new Error('first track stop failed'); });
    const secondStop = vi.fn();
    const local = stream([track(firstStop), track(secondStop)]);

    const dependencies = {
      getUserMedia: vi.fn(async () => local),
      getDisplayMedia: vi.fn(async () => { throw new Error('picker cancelled'); }),
      startTranscription: vi.fn(async () => ({ sessionId: 'unused' })),
      stopTranscription: vi.fn(async () => undefined),
      startLiveAudioStream: vi.fn(async ({ source }: { source: 'local' | 'remote' }) => handle(source)),
      now: vi.fn(() => 0),
    };

    await expect(startCaptureSession({}, dependencies)).rejects.toThrow('picker cancelled');

    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).toHaveBeenCalledOnce();
    expect(dependencies.startTranscription).not.toHaveBeenCalled();
  });
});
