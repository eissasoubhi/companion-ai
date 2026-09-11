import { describe, expect, it, vi } from 'vitest';

import {
  describeSystemAudioError,
  runSystemAudioDiagnostic,
} from './system-audio-diagnostic.js';

describe('system audio diagnostics', () => {
  it('turns a denied sharing request into an actionable blocked state', () => {
    const result = describeSystemAudioError(
      new DOMException('Permission denied', 'NotAllowedError'),
    );

    expect(result.state).toBe('blocked');
    expect(result.message).toContain('cancelled or denied');
    expect(result.action).toContain('macOS sharing prompt');
  });

  it('fails closed when the platform capability is unsupported', async () => {
    const getDisplayMedia = vi.fn();

    const result = await runSystemAudioDiagnostic({
      getCapability: async () => ({
        supported: false,
        mode: 'unsupported',
        platform: 'darwin',
        systemVersion: '14.7.0',
        reason: 'Native system picker path is not available.',
      }),
      getDisplayMedia,
      createAudioContext: () => {
        throw new Error('should not be called');
      },
    });

    expect(result.state).toBe('blocked');
    expect(result.message).toContain('not available');
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it('does not mark a display stream ready when no audio track exists', async () => {
    const stop = vi.fn();
    const stream = {
      getAudioTracks: () => [],
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;

    const result = await runSystemAudioDiagnostic({
      getCapability: async () => ({
        supported: true,
        mode: 'macos-system-picker',
        platform: 'darwin',
        systemVersion: '15.0.0',
      }),
      getDisplayMedia: async () => stream,
      createAudioContext: () => {
        throw new Error('should not be called');
      },
    });

    expect(result.state).toBe('blocked');
    expect(result.message).toContain('did not provide');
    expect(stop).toHaveBeenCalledOnce();
  });
});
