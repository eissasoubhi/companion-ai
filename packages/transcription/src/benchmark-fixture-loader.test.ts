import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_TRANSCRIPT_BENCHMARK_CHUNK_BYTES,
  loadTranscriptBenchmarkFixtureSet,
  type TranscriptBenchmarkFixtureManifest,
} from './index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createFixtureSet(
  audio: Uint8Array,
  overrides: Partial<TranscriptBenchmarkFixtureManifest['entries'][number]> = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'companion-ai-benchmark-'));
  tempDirs.push(root);

  const audioPath = join(root, 'case-one.pcm');
  await writeFile(audioPath, audio);

  const manifest: TranscriptBenchmarkFixtureManifest = {
    version: 1,
    fixtureSetId: 'synthetic-v1',
    corpusVersion: 'v1',
    entries: [
      {
        caseId: 'case-one',
        source: 'remote',
        path: 'case-one.pcm',
        sha256: createHash('sha256').update(audio).digest('hex'),
        encoding: 'pcm-s16le',
        sampleRateHz: 16_000,
        channels: 1,
        ...overrides,
      },
    ],
  };

  const manifestPath = join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

describe('loadTranscriptBenchmarkFixtureSet', () => {
  it('verifies and chunks PCM audio into bounded frame-aligned chunks', async () => {
    const audio = new Uint8Array(3_200);
    const manifestPath = await createFixtureSet(audio);

    const loaded = await loadTranscriptBenchmarkFixtureSet(manifestPath, ['case-one'], {
      chunkDurationMs: 50,
    });

    expect(loaded.manifest.fixtureSetId).toBe('synthetic-v1');
    expect(loaded.fixtures).toHaveLength(1);
    expect(loaded.fixtures[0]?.source).toBe('remote');
    expect(loaded.fixtures[0]?.chunks).toHaveLength(2);
    expect(loaded.fixtures[0]?.chunks.map((chunk) => chunk.data.byteLength)).toEqual([1600, 1600]);
    expect(loaded.fixtures[0]?.chunks.map((chunk) => chunk.sequence)).toEqual([0, 1]);
    expect(loaded.fixtures[0]?.chunks.map((chunk) => chunk.capturedAtMs)).toEqual([0, 50]);
  });

  it('hard-bounds chunks even when the requested duration is extreme', async () => {
    const audio = new Uint8Array(MAX_TRANSCRIPT_BENCHMARK_CHUNK_BYTES * 3);
    const manifestPath = await createFixtureSet(audio);

    const loaded = await loadTranscriptBenchmarkFixtureSet(manifestPath, ['case-one'], {
      chunkDurationMs: 60_000,
    });

    const chunks = loaded.fixtures[0]?.chunks ?? [];
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.data.byteLength))).toBeLessThanOrEqual(
      MAX_TRANSCRIPT_BENCHMARK_CHUNK_BYTES,
    );
    expect(chunks.every((chunk) => chunk.data.byteLength % 2 === 0)).toBe(true);
  });

  it('fails closed when fixture bytes do not match the manifest hash', async () => {
    const manifestPath = await createFixtureSet(new Uint8Array([1, 2, 3, 4]));
    await writeFile(join(manifestPath, '..', 'case-one.pcm'), new Uint8Array([9, 9, 9, 9]));

    await expect(loadTranscriptBenchmarkFixtureSet(manifestPath)).rejects.toThrow(
      'benchmark fixture sha256 mismatch: case-one',
    );
  });

  it('rejects unaligned PCM and unsupported raw opus fixtures', async () => {
    const unaligned = await createFixtureSet(new Uint8Array([1, 2, 3]));
    await expect(loadTranscriptBenchmarkFixtureSet(unaligned)).rejects.toThrow(
      'benchmark fixture PCM byte length is invalid: case-one',
    );

    const opus = await createFixtureSet(new Uint8Array([1, 2, 3, 4]), {
      encoding: 'opus',
    });
    await expect(loadTranscriptBenchmarkFixtureSet(opus)).rejects.toThrow(
      'benchmark fixture loader does not support raw opus chunking: case-one',
    );
  });

  it('rejects malformed JSON and invalid chunk durations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-ai-benchmark-'));
    tempDirs.push(root);
    const manifestPath = join(root, 'manifest.json');
    await writeFile(manifestPath, '{');

    await expect(loadTranscriptBenchmarkFixtureSet(manifestPath)).rejects.toThrow(
      'benchmark fixture manifest is not valid JSON',
    );

    const validManifestPath = await createFixtureSet(new Uint8Array([1, 2, 3, 4]));
    await expect(
      loadTranscriptBenchmarkFixtureSet(validManifestPath, undefined, { chunkDurationMs: 0 }),
    ).rejects.toThrow('chunkDurationMs must be a positive finite number');
  });
});
