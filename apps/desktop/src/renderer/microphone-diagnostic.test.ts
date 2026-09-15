import { describe, expect, it, vi } from 'vitest';

import {
  describeMicrophoneError,
  runMicrophoneDiagnostic,
} from './microphone-diagnostic.js';

describe('microphone diagnostics', () => {
  it('turns a denied permission into an actionable blocked state', () => {
    const result = describeMicrophoneError(
      new DOMException('Permission denied', 'NotAllowedError'),
    );

    expect(result.state).toBe('blocked');
    expect(result.message).toContain('could not access');
    expect(result.action).toContain('privacy settings');
  });

  it('explains when no input device exists', () => {
    const result = describeMicrophoneError(
      new DOMException('No device', 'NotFoundError'),
    );

    expect(result.state).toBe('blocked');
    expect(result.message).toContain('No microphone');
    expect(result.action).toContain('Connect or enable');
  });

  it('keeps unexpected failures distinct from permission failures', () => {
    const result = describeMicrophoneError(new Error('boom'));

    expect(result.state).toBe('error');
    expect(result.message).toContain('unexpectedly');
  });

  it('stops every acquired track even when one track cleanup throws', async () => {
    const brokenStop = vi.fn(() => {
      throw new Error('track stop failed');
    });
    const healthyStop = vi.fn();
    const brokenTrack = { stop: brokenStop } as unknown as MediaStreamTrack;
    const healthyTrack = { stop: healthyStop } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [],
      getTracks: () => [brokenTrack, healthyTrack],
    } as unknown as MediaStream;

    const result = await runMicrophoneDiagnostic({
      getPermissionStatus: vi.fn(async () => 'granted' as MediaAccessStatus),
      requestPermission: vi.fn(async () => 'granted' as MediaAccessStatus),
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => []),
      createAudioContext: vi.fn(),
    });

    expect(result.state).toBe('blocked');
    expect(result.message).toContain('without a microphone track');
    expect(brokenStop).toHaveBeenCalledOnce();
    expect(healthyStop).toHaveBeenCalledOnce();
  });
});
