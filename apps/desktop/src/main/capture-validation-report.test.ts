import { describe, expect, it } from 'vitest';

import { buildCaptureValidationReport } from './capture-validation-report.js';
import type { CaptureValidationTarget } from './capture-validation-evidence.js';

function evidence(target: CaptureValidationTarget, localMs: number, remoteMs: number, recordedAt: string) {
  return {
    schemaVersion: 1,
    recordedAt,
    platform: { os: 'macos', version: '15.6.1', arch: 'arm64' },
    app: { target, version: '1.2.3' },
    capture: {
      local: { opened: true, liveTrack: true, signalDetected: true, startupLatencyMs: localMs },
      remote: { opened: true, liveTrack: true, signalDetected: true, startupLatencyMs: remoteMs },
    },
    rawAudioPersisted: false,
    notes: 'Sensitive free-form note that must never appear in the report.',
  };
}

describe('buildCaptureValidationReport', () => {
  it('reports missing targets without claiming readiness', () => {
    const report = buildCaptureValidationReport([
      evidence('browser-media', 120, 240, '2026-09-14T08:00:00.000Z'),
      evidence('google-meet', 140, 310, '2026-09-14T08:05:00.000Z'),
    ]);

    expect(report.ready).toBe(false);
    expect(report.missingTargets).toEqual(['microsoft-teams', 'zoom']);
    expect(report.platform).toEqual({ os: 'macos', version: '15.6.1', arch: 'arm64' });
    expect(report.maxStartupLatencyMs).toEqual({ local: 140, remote: 310 });
    expect(report.targets).toEqual([
      {
        target: 'browser-media',
        status: 'verified',
        recordedAt: '2026-09-14T08:00:00.000Z',
        appVersion: '1.2.3',
        startupLatencyMs: { local: 120, remote: 240 },
      },
      {
        target: 'google-meet',
        status: 'verified',
        recordedAt: '2026-09-14T08:05:00.000Z',
        appVersion: '1.2.3',
        startupLatencyMs: { local: 140, remote: 310 },
      },
      { target: 'microsoft-teams', status: 'missing' },
      { target: 'zoom', status: 'missing' },
    ]);
  });

  it('marks readiness only when all required targets pass the strict evidence parser', () => {
    const report = buildCaptureValidationReport([
      evidence('browser-media', 100, 200, '2026-09-14T08:00:00.000Z'),
      evidence('google-meet', 110, 210, '2026-09-14T08:05:00.000Z'),
      evidence('microsoft-teams', 120, 220, '2026-09-14T08:10:00.000Z'),
      evidence('zoom', 130, 230, '2026-09-14T08:15:00.000Z'),
    ]);

    expect(report.ready).toBe(true);
    expect(report.missingTargets).toEqual([]);
  });

  it('never exposes raw-audio fields or free-form notes in the report', () => {
    const report = buildCaptureValidationReport([
      evidence('browser-media', 100, 200, '2026-09-14T08:00:00.000Z'),
    ]);
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain('Sensitive free-form note');
    expect(serialized).not.toContain('rawAudioPersisted');
    expect(serialized).not.toContain('notes');
  });

  it('returns a safe empty report when no manual validation exists yet', () => {
    expect(buildCaptureValidationReport([])).toEqual({
      schemaVersion: 1,
      ready: false,
      platform: null,
      targets: [
        { target: 'browser-media', status: 'missing' },
        { target: 'google-meet', status: 'missing' },
        { target: 'microsoft-teams', status: 'missing' },
        { target: 'zoom', status: 'missing' },
      ],
      missingTargets: ['browser-media', 'google-meet', 'microsoft-teams', 'zoom'],
      maxStartupLatencyMs: null,
    });
  });
});
