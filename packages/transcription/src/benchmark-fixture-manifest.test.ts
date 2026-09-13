import { describe, expect, it } from 'vitest';

import {
  TRANSCRIPT_BENCHMARK_FIXTURE_MANIFEST_VERSION,
  assertTranscriptBenchmarkFixtureManifest,
  type TranscriptBenchmarkFixtureManifest,
} from './benchmark-fixture-manifest.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function manifest(
  overrides: Partial<TranscriptBenchmarkFixtureManifest> = {},
): TranscriptBenchmarkFixtureManifest {
  return {
    version: TRANSCRIPT_BENCHMARK_FIXTURE_MANIFEST_VERSION,
    fixtureSetId: 'synthetic-interview-audio-v1',
    corpusVersion: 'v1',
    entries: [
      {
        caseId: 'case-one',
        source: 'remote',
        path: 'audio/case-one.pcm',
        sha256: HASH_A,
        encoding: 'pcm16le',
        sampleRateHz: 16_000,
        channels: 1,
      },
      {
        caseId: 'case-two',
        source: 'local',
        path: 'audio/case-two.pcm',
        sha256: HASH_B,
        encoding: 'pcm16le',
        sampleRateHz: 16_000,
        channels: 1,
      },
    ],
    ...overrides,
  };
}

describe('assertTranscriptBenchmarkFixtureManifest', () => {
  it('accepts a complete versioned fixture set matching the corpus cases', () => {
    expect(() =>
      assertTranscriptBenchmarkFixtureManifest(manifest(), ['case-one', 'case-two']),
    ).not.toThrow();
  });

  it('rejects unsupported manifest versions', () => {
    expect(() =>
      assertTranscriptBenchmarkFixtureManifest({ ...manifest(), version: 2 as 1 }),
    ).toThrow('unsupported benchmark fixture manifest version: 2');
  });

  it('rejects duplicate case ids and paths', () => {
    const base = manifest();
    const first = base.entries[0]!;

    expect(() =>
      assertTranscriptBenchmarkFixtureManifest({
        ...base,
        entries: [first, { ...first, sha256: HASH_B }],
      }),
    ).toThrow('duplicate benchmark fixture caseId: case-one');

    expect(() =>
      assertTranscriptBenchmarkFixtureManifest({
        ...base,
        entries: [first, { ...base.entries[1]!, path: first.path }],
      }),
    ).toThrow('duplicate benchmark fixture path: audio/case-one.pcm');
  });

  it('rejects unsafe paths and malformed hashes before file IO', () => {
    const base = manifest();

    expect(() =>
      assertTranscriptBenchmarkFixtureManifest({
        ...base,
        entries: [{ ...base.entries[0]!, path: '../secret.pcm' }],
      }),
    ).toThrow('benchmark fixture path must be a safe relative path: case-one');

    expect(() =>
      assertTranscriptBenchmarkFixtureManifest({
        ...base,
        entries: [{ ...base.entries[0]!, sha256: 'not-a-hash' }],
      }),
    ).toThrow('benchmark fixture sha256 is invalid: case-one');
  });

  it('fails closed when the manifest and corpus case sets differ', () => {
    expect(() =>
      assertTranscriptBenchmarkFixtureManifest(manifest(), ['case-one', 'case-three']),
    ).toThrow('missing benchmark fixture manifest entry: case-three');

    expect(() =>
      assertTranscriptBenchmarkFixtureManifest(manifest(), ['case-one']),
    ).toThrow('unexpected benchmark fixture manifest entry: case-two');
  });

  it('rejects invalid audio metadata and duplicate expected case ids', () => {
    const base = manifest();

    expect(() =>
      assertTranscriptBenchmarkFixtureManifest({
        ...base,
        entries: [{ ...base.entries[0]!, sampleRateHz: 0 }],
      }),
    ).toThrow('benchmark fixture sampleRateHz is invalid: case-one');

    expect(() =>
      assertTranscriptBenchmarkFixtureManifest(base, ['case-one', 'case-one']),
    ).toThrow('duplicate expected benchmark caseId: case-one');
  });
});
