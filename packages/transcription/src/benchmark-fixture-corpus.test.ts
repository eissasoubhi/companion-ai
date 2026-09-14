import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadTranscriptBenchmarkFixtureSet } from './benchmark-fixture-loader.js';

const CASE_IDS = [
  'endpoint-en-question',
  'pause-before-en-question',
  'pause-after-en-question',
] as const;

const manifestPath = fileURLToPath(
  new URL('../fixtures/operational-synthetic-v1/manifest.json', import.meta.url),
);

describe('committed operational synthetic benchmark corpus', () => {
  it('loads verified PCM for every required operational scenario role', async () => {
    const loaded = await loadTranscriptBenchmarkFixtureSet(manifestPath, CASE_IDS);

    expect(loaded.manifest.fixtureSetId).toBe('operational-synthetic-en-v1');
    expect(loaded.manifest.corpusVersion).toBe('operational-synthetic-en-v1');
    expect(loaded.fixtures.map((fixture) => fixture.caseId)).toEqual(CASE_IDS);

    for (const fixture of loaded.fixtures) {
      expect(fixture.source).toBe('remote');
      expect(fixture.chunks.length).toBeGreaterThan(0);
      expect(fixture.chunks.every((chunk) => chunk.encoding === 'pcm-s16le')).toBe(true);
      expect(fixture.chunks.every((chunk) => chunk.sampleRateHz === 16_000)).toBe(true);
      expect(fixture.chunks.every((chunk) => chunk.channels === 1)).toBe(true);
      expect(fixture.chunks.every((chunk) => chunk.data.byteLength <= 64 * 1024)).toBe(true);
    }
  });
});
