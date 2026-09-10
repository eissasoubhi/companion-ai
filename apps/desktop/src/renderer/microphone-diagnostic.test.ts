import { describe, expect, it } from 'vitest';

import { describeMicrophoneError } from './microphone-diagnostic.js';

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
});
