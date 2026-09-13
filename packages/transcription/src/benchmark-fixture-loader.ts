import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import {
  assertTranscriptBenchmarkFixtureManifest,
  type TranscriptBenchmarkFixtureManifest,
  type TranscriptBenchmarkFixtureManifestEntry,
} from './benchmark-fixture-manifest.js';
import type {
  TranscriptBenchmarkAudioFixture,
  TranscriptBenchmarkFixtureChunk,
} from './benchmark-execution.js';

export interface TranscriptBenchmarkFixtureLoaderOptions {
  readonly chunkDurationMs?: number | undefined;
}

export interface LoadedTranscriptBenchmarkFixtureSet {
  readonly manifest: TranscriptBenchmarkFixtureManifest;
  readonly fixtures: readonly TranscriptBenchmarkAudioFixture[];
}

const DEFAULT_CHUNK_DURATION_MS = 100;

function normalizedChunkDurationMs(value: number | undefined): number {
  const durationMs = value ?? DEFAULT_CHUNK_DURATION_MS;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('chunkDurationMs must be a positive finite number');
  }
  return durationMs;
}

function parseManifest(content: string): TranscriptBenchmarkFixtureManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error('benchmark fixture manifest is not valid JSON', { cause: error });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('benchmark fixture manifest must be a JSON object');
  }

  const manifest = parsed as TranscriptBenchmarkFixtureManifest;
  assertTranscriptBenchmarkFixtureManifest(manifest);
  return manifest;
}

function bytesPerSample(entry: TranscriptBenchmarkFixtureManifestEntry): number {
  switch (entry.encoding) {
    case 'pcm-s16le':
      return 2;
    case 'pcm-f32le':
      return 4;
    case 'opus':
      throw new Error(
        `benchmark fixture loader does not support raw opus chunking: ${entry.caseId}`,
      );
  }
}

function assertInsideRoot(root: string, filePath: string, caseId: string): void {
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    throw new Error(`benchmark fixture resolved outside manifest directory: ${caseId}`);
  }
}

function chunkPcmFixture(
  entry: TranscriptBenchmarkFixtureManifestEntry,
  bytes: Uint8Array,
  chunkDurationMs: number,
): readonly TranscriptBenchmarkFixtureChunk[] {
  const frameBytes = bytesPerSample(entry) * entry.channels;
  if (bytes.byteLength === 0 || bytes.byteLength % frameBytes !== 0) {
    throw new Error(`benchmark fixture PCM byte length is invalid: ${entry.caseId}`);
  }

  const framesPerChunk = Math.max(1, Math.floor((entry.sampleRateHz * chunkDurationMs) / 1_000));
  const bytesPerChunk = framesPerChunk * frameBytes;
  const chunks: TranscriptBenchmarkFixtureChunk[] = [];

  for (let offset = 0, sequence = 0; offset < bytes.byteLength; offset += bytesPerChunk, sequence += 1) {
    const end = Math.min(offset + bytesPerChunk, bytes.byteLength);
    const startFrame = offset / frameBytes;
    chunks.push({
      sequence,
      capturedAtMs: (startFrame / entry.sampleRateHz) * 1_000,
      sampleRateHz: entry.sampleRateHz,
      channels: entry.channels,
      encoding: entry.encoding,
      data: bytes.slice(offset, end),
    });
  }

  return chunks;
}

export async function loadTranscriptBenchmarkFixtureSet(
  manifestPath: string,
  expectedCaseIds?: readonly string[],
  options: TranscriptBenchmarkFixtureLoaderOptions = {},
): Promise<LoadedTranscriptBenchmarkFixtureSet> {
  if (manifestPath.trim().length === 0) {
    throw new Error('manifestPath must not be empty');
  }

  const chunkDurationMs = normalizedChunkDurationMs(options.chunkDurationMs);
  const absoluteManifestPath = resolve(manifestPath);
  const root = dirname(absoluteManifestPath);
  const manifest = parseManifest(await readFile(absoluteManifestPath, 'utf8'));
  assertTranscriptBenchmarkFixtureManifest(manifest, expectedCaseIds);

  const fixtures: TranscriptBenchmarkAudioFixture[] = [];
  for (const entry of manifest.entries) {
    const absoluteFixturePath = resolve(root, entry.path);
    assertInsideRoot(root, absoluteFixturePath, entry.caseId);

    const file = await readFile(absoluteFixturePath);
    const actualHash = createHash('sha256').update(file).digest('hex');
    if (actualHash !== entry.sha256) {
      throw new Error(`benchmark fixture sha256 mismatch: ${entry.caseId}`);
    }

    fixtures.push({
      caseId: entry.caseId,
      source: entry.source,
      chunks: chunkPcmFixture(entry, file, chunkDurationMs),
    });
  }

  return { manifest, fixtures };
}
