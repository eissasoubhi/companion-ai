import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { BenchmarkAudioEvidence } from './benchmark-audio-evidence.js';
import { loadTranscriptBenchmarkFixtureSet } from './benchmark-fixture-loader.js';
import type { TranscriptBenchmarkFixtureManifest } from './benchmark-fixture-manifest.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createFixture(): Promise<{
  manifestPath: string;
  evidence: BenchmarkAudioEvidence;
}> {
  const root = await mkdtemp(join(tmpdir(), 'companion-ai-evidence-'));
  tempDirs.push(root);
  const audio = new Uint8Array([1, 2, 3, 4]);
  const sha256 = createHash('sha256').update(audio).digest('hex');
  const file = 'case-one.pcm';
  await writeFile(join(root, file), audio);

  const manifest: TranscriptBenchmarkFixtureManifest = {
    version: 1,
    fixtureSetId: 'evidence-v1',
    corpusVersion: 'v1',
    entries: [{
      caseId: 'case-one',
      source: 'remote',
      path: file,
      sha256,
      encoding: 'pcm-s16le',
      sampleRateHz: 16_000,
      channels: 1,
    }],
  };
  const manifestPath = join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));

  return {
    manifestPath,
    evidence: {
      corpusCaseId: 'case-one',
      file,
      sha256,
      origin: 'synthetic',
      consentRecorded: false,
      noise: 'moderate-background',
      accent: 'accent-variation',
    },
  };
}

describe('benchmark audio evidence fixture binding', () => {
  it('loads only when evidence path and digest match the verified fixture bytes', async () => {
    const { manifestPath, evidence } = await createFixture();

    const loaded = await loadTranscriptBenchmarkFixtureSet(manifestPath, ['case-one'], {
      audioEvidence: [evidence],
    });

    expect(loaded.fixtures).toHaveLength(1);
    expect(Array.from(loaded.fixtures[0]?.chunks[0]?.data ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('fails closed when provenance points at a different file or digest', async () => {
    const { manifestPath, evidence } = await createFixture();

    await expect(loadTranscriptBenchmarkFixtureSet(manifestPath, ['case-one'], {
      audioEvidence: [{ ...evidence, file: 'other.pcm' }],
    })).rejects.toThrow('benchmark audio evidence path mismatch: case-one');

    await expect(loadTranscriptBenchmarkFixtureSet(manifestPath, ['case-one'], {
      audioEvidence: [{ ...evidence, sha256: 'f'.repeat(64) }],
    })).rejects.toThrow('benchmark audio evidence sha256 mismatch: case-one');
  });

  it('fails closed when fixture bytes are changed after evidence was recorded', async () => {
    const { manifestPath, evidence } = await createFixture();
    await writeFile(join(manifestPath, '..', evidence.file), new Uint8Array([9, 9, 9, 9]));

    await expect(loadTranscriptBenchmarkFixtureSet(manifestPath, ['case-one'], {
      audioEvidence: [evidence],
    })).rejects.toThrow('benchmark fixture sha256 mismatch: case-one');
  });

  it('requires one evidence record per manifest entry', async () => {
    const { manifestPath } = await createFixture();

    await expect(loadTranscriptBenchmarkFixtureSet(manifestPath, ['case-one'], {
      audioEvidence: [],
    })).rejects.toThrow('missing benchmark audio evidence for fixture: case-one');
  });
});
