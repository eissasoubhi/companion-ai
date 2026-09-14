import { describe, expect, it } from 'vitest';

import {
  buildCaptureValidationMatrix,
  parseCaptureValidationEvidence,
  type CaptureValidationTarget,
} from './capture-validation-evidence.js';

function evidence(target: CaptureValidationTarget, recordedAt = '2026-09-14T08:00:00.000Z') {
  return {
    schemaVersion: 1,
    recordedAt,
    platform: {
      os: 'macos',
      version: '15.6.1',
      arch: 'arm64',
    },
    app: {
      target,
      version: 'test-version',
    },
    capture: {
      local: {
        opened: true,
        liveTrack: true,
        signalDetected: true,
        startupLatencyMs: 125,
      },
      remote: {
        opened: true,
        liveTrack: true,
        signalDetected: true,
        startupLatencyMs: 240,
      },
    },
    rawAudioPersisted: false,
  };
}

describe('parseCaptureValidationEvidence', () => {
  it('accepts explicit local and remote proof without raw audio persistence', () => {
    expect(parseCaptureValidationEvidence(evidence('browser-media'))).toMatchObject({
      app: { target: 'browser-media' },
      capture: {
        local: { signalDetected: true },
        remote: { signalDetected: true },
      },
      rawAudioPersisted: false,
    });
  });

  it('fails closed when either capture channel is not actually verified', () => {
    const value = evidence('zoom');
    value.capture.remote.signalDetected = false;

    expect(() => parseCaptureValidationEvidence(value)).toThrow(
      'capture.remote must prove opened capture, a live track and detected signal.',
    );
  });

  it('rejects embedded or unexpected fields so raw audio cannot be smuggled into evidence', () => {
    const value = {
      ...evidence('browser-media'),
      rawAudioBase64: 'AAAA',
    };

    expect(() => parseCaptureValidationEvidence(value)).toThrow('invalid shape');
  });

  it('rejects implausible or unbounded startup latency values', () => {
    const value = evidence('browser-media');
    value.capture.local.startupLatencyMs = 30_001;

    expect(() => parseCaptureValidationEvidence(value)).toThrow('startupLatencyMs');
  });
});

describe('buildCaptureValidationMatrix', () => {
  it('requires browser media plus Meet, Teams and Zoom before marking P0 capture validation ready', () => {
    const partial = buildCaptureValidationMatrix([
      evidence('browser-media', '2026-09-14T08:00:00.000Z'),
      evidence('google-meet', '2026-09-14T08:05:00.000Z'),
    ]);

    expect(partial.ready).toBe(false);
    expect(partial.missingTargets).toEqual(['microsoft-teams', 'zoom']);

    const complete = buildCaptureValidationMatrix([
      evidence('browser-media', '2026-09-14T08:00:00.000Z'),
      evidence('google-meet', '2026-09-14T08:05:00.000Z'),
      evidence('microsoft-teams', '2026-09-14T08:10:00.000Z'),
      evidence('zoom', '2026-09-14T08:15:00.000Z'),
    ]);

    expect(complete.ready).toBe(true);
    expect(complete.missingTargets).toEqual([]);
  });

  it('rejects duplicate targets instead of silently replacing evidence', () => {
    expect(() =>
      buildCaptureValidationMatrix([evidence('browser-media'), evidence('browser-media')]),
    ).toThrow('Duplicate capture validation target: browser-media.');
  });

  it('enforces the acceptance order: browser media first, then conferencing apps', () => {
    expect(() =>
      buildCaptureValidationMatrix([
        evidence('browser-media', '2026-09-14T08:10:00.000Z'),
        evidence('google-meet', '2026-09-14T08:05:00.000Z'),
      ]),
    ).toThrow('browser-media validation must be recorded before Meet, Teams and Zoom.');
  });
});
