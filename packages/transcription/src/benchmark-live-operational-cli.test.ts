import { describe, expect, it } from 'vitest';

import {
  buildTranscriptOperationalAudioFixtures,
  parseLiveOperationalCliArgs,
} from './benchmark-live-operational-cli.js';
import type { TranscriptBenchmarkAudioFixture } from './benchmark-execution.js';

function fixture(
  caseId: string,
  source: 'local' | 'remote' = 'remote',
  sampleRateHz = 16_000,
): TranscriptBenchmarkAudioFixture {
  return {
    caseId,
    source,
    chunks: [
      {
        sequence: 7,
        capturedAtMs: 0,
        sampleRateHz,
        channels: 1,
        encoding: 'pcm-s16le',
        data: new Uint8Array(3_200),
      },
      {
        sequence: 9,
        capturedAtMs: 100,
        sampleRateHz,
        channels: 1,
        encoding: 'pcm-s16le',
        data: new Uint8Array(3_200),
      },
    ],
  };
}

describe('parseLiveOperationalCliArgs', () => {
  it('parses required identifiers and optional timeout', () => {
    const parsed = parseLiveOperationalCliArgs([
      'fixtures/manifest.json',
      'out.json',
      'run-2026-09-14',
      'endpoint',
      'pause-before',
      'pause-after',
      '750',
      '5000',
    ]);

    expect(parsed.benchmarkRunId).toBe('run-2026-09-14');
    expect(parsed.pauseMs).toBe(750);
    expect(parsed.timeoutMs).toBe(5000);
    expect(parsed.manifestPath).toMatch(/manifest\.json$/);
    expect(parsed.outputPath).toMatch(/out\.json$/);
  });

  it('rejects invalid numeric bounds and non-canonical ids', () => {
    expect(() =>
      parseLiveOperationalCliArgs([
        'manifest.json',
        'out.json',
        ' run ',
        'endpoint',
        'before',
        'after',
        '750',
      ]),
    ).toThrow(/benchmark-run-id/);
    expect(() =>
      parseLiveOperationalCliArgs([
        'manifest.json',
        'out.json',
        'run',
        'endpoint',
        'before',
        'after',
        '0',
      ]),
    ).toThrow(/pause-ms/);
  });
});

describe('buildTranscriptOperationalAudioFixtures', () => {
  it('preserves source/format, resequences pause chunks and measures audio end', () => {
    const built = buildTranscriptOperationalAudioFixtures(
      fixture('endpoint'),
      fixture('before'),
      fixture('after'),
      800,
    );

    expect(built.endpointFinalization.audioEndedAtMs).toBe(200);
    expect(built.endpointFinalization.chunks.map((chunk) => chunk.sequence)).toEqual([0, 1]);
    expect(built.endpointFinalization.chunks.every((chunk) => chunk.source === 'remote')).toBe(true);
    expect(built.falseFinalization.beforePauseChunks.map((chunk) => chunk.sequence)).toEqual([0, 1]);
    expect(built.falseFinalization.afterPauseChunks.map((chunk) => chunk.sequence)).toEqual([2, 3]);
    expect(built.falseFinalization.pauseMs).toBe(800);
  });

  it('fails closed when pause fixtures do not share source or format', () => {
    expect(() =>
      buildTranscriptOperationalAudioFixtures(
        fixture('endpoint'),
        fixture('before', 'remote'),
        fixture('after', 'local'),
        800,
      ),
    ).toThrow(/share source and audio format/);

    expect(() =>
      buildTranscriptOperationalAudioFixtures(
        fixture('endpoint'),
        fixture('before', 'remote', 16_000),
        fixture('after', 'remote', 48_000),
        800,
      ),
    ).toThrow(/share source and audio format/);
  });
});
