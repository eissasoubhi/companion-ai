import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_CAPTURE_EVIDENCE_FILE_BYTES,
  runCaptureValidationCli,
} from './capture-validation-cli.js';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'companion-capture-validation-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function evidence(target: 'browser-media' | 'google-meet' | 'microsoft-teams' | 'zoom', recordedAt: string) {
  return {
    schemaVersion: 1,
    recordedAt,
    platform: { os: 'macos', version: '15.6.1', arch: 'arm64' },
    app: { target, version: '1.0.0' },
    capture: {
      local: { opened: true, liveTrack: true, signalDetected: true, startupLatencyMs: 120 },
      remote: { opened: true, liveTrack: true, signalDetected: true, startupLatencyMs: 240 },
    },
    rawAudioPersisted: false,
    notes: 'must never appear in the readiness report',
  };
}

async function writeEvidence(dir: string, name: string, value: unknown): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(value), 'utf8');
  return path;
}

describe('capture validation CLI', () => {
  it('returns zero only for a complete validated matrix and omits notes', async () => {
    const dir = await createTempDir();
    const paths = await Promise.all([
      writeEvidence(dir, 'browser.json', evidence('browser-media', '2026-09-14T10:00:00Z')),
      writeEvidence(dir, 'meet.json', evidence('google-meet', '2026-09-14T10:01:00Z')),
      writeEvidence(dir, 'teams.json', evidence('microsoft-teams', '2026-09-14T10:02:00Z')),
      writeEvidence(dir, 'zoom.json', evidence('zoom', '2026-09-14T10:03:00Z')),
    ]);

    const result = await runCaptureValidationCli(paths);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('must never appear');
    expect(JSON.parse(result.stdout)).toMatchObject({ ready: true, missingTargets: [] });
  });

  it('returns exit code 2 with a machine-readable report when evidence is incomplete', async () => {
    const dir = await createTempDir();
    const browser = await writeEvidence(dir, 'browser.json', evidence('browser-media', '2026-09-14T10:00:00Z'));

    const result = await runCaptureValidationCli([browser]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ready: false,
      missingTargets: ['google-meet', 'microsoft-teams', 'zoom'],
    });
    expect(result.stderr).toContain('Capture validation is incomplete');
  });

  it('fails closed for invalid JSON and duplicate targets', async () => {
    const dir = await createTempDir();
    const invalid = join(dir, 'invalid.json');
    await writeFile(invalid, '{', 'utf8');

    const invalidResult = await runCaptureValidationCli([invalid]);
    expect(invalidResult.exitCode).toBe(1);
    expect(invalidResult.stdout).toBe('');
    expect(invalidResult.stderr).toContain('not valid JSON');

    const first = await writeEvidence(dir, 'first.json', evidence('browser-media', '2026-09-14T10:00:00Z'));
    const duplicate = await writeEvidence(dir, 'duplicate.json', evidence('browser-media', '2026-09-14T10:01:00Z'));
    const duplicateResult = await runCaptureValidationCli([first, duplicate]);
    expect(duplicateResult.exitCode).toBe(1);
    expect(duplicateResult.stderr).toContain('Duplicate capture validation target');
  });

  it('rejects files larger than the bounded input limit', async () => {
    const dir = await createTempDir();
    const oversized = join(dir, 'oversized.json');
    await writeFile(oversized, 'x'.repeat(MAX_CAPTURE_EVIDENCE_FILE_BYTES + 1), 'utf8');

    const result = await runCaptureValidationCli([oversized]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('exceeds');
  });

  it('rejects empty input and more files than the target matrix allows', async () => {
    expect((await runCaptureValidationCli([])).exitCode).toBe(1);
    expect((await runCaptureValidationCli(['a', 'b', 'c', 'd', 'e'])).exitCode).toBe(1);
  });
});
