import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

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
  readonly maxFixtureBytes?: number | undefined;
}

export interface LoadedTranscriptBenchmarkFixtureSet {
  readonly manifest: TranscriptBenchmarkFixtureManifest;
  readonly fixtures: readonly TranscriptBenchmarkAudioFixture[];
}

const DEFAULT_CHUNK_DURATION_MS = 100;
export const MAX_TRANSCRIPT_BENCHMARK_CHUNK_BYTES = 64 * 1024;
export const DEFAULT_MAX_TRANSCRIPT_BENCHMARK_FIXTURE_BYTES = 32 * 1024 * 1024;

function normalizedChunkDurationMs(value: number | undefined): number {
  const durationMs = value ?? DEFAULT_CHUNK_DURATION_MS;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('chunkDurationMs must be a positive finite number');
  }
  return durationMs;
}

function normalizedMaxFixtureBytes(value: number | undefined): number {
  const maxFixtureBytes = value ?? DEFAULT_MAX_TRANSCRIPT_BENCHMARK_FIXTURE_BYTES;
  if (!Number.isSafeInteger(maxFixtureBytes) || maxFixtureBytes <= 0) {
    throw new RangeError('maxFixtureBytes must be a positive safe integer');
  }
  return maxFixtureBytes;
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

function maxStoredFixtureBytes(
  entry: TranscriptBenchmarkFixtureManifestEntry,
  maxFixtureBytes: number,
): number {
  if ((entry.storageEncoding ?? 'raw') === 'raw') return maxFixtureBytes;
  const encodedBound = maxFixtureBytes * 2;
  if (!Number.isSafeInteger(encodedBound)) {
    throw new RangeError('maxFixtureBytes is too large for encoded fixture storage');
  }
  return encodedBound;
}

async function readBoundedFixture(
  filePath: string,
  caseId: string,
  maxStoredBytes: number,
): Promise<Uint8Array> {
  const metadata = await stat(filePath);
  if (!metadata.isFile()) {
    throw new Error(`benchmark fixture path is not a regular file: ${caseId}`);
  }
  if (metadata.size > maxStoredBytes) {
    throw new Error(
      `benchmark fixture exceeds stored byte limit: ${caseId} (${metadata.size} > ${maxStoredBytes})`,
    );
  }
  return readFile(filePath);
}

function decodeCanonicalBase64(
  entry: TranscriptBenchmarkFixtureManifestEntry,
  stored: Uint8Array,
): Buffer {
  const compact = Buffer.from(stored).toString('utf8').replaceAll(/\s/g, '');
  if (
    compact.length === 0 ||
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    throw new Error(`benchmark fixture base64 is invalid: ${entry.caseId}`);
  }

  const decoded = Buffer.from(compact, 'base64');
  if (decoded.toString('base64') !== compact) {
    throw new Error(`benchmark fixture base64 is not canonical: ${entry.caseId}`);
  }
  return decoded;
}

function assertDecodedBound(
  entry: TranscriptBenchmarkFixtureManifestEntry,
  decoded: Uint8Array,
  maxFixtureBytes: number,
): Uint8Array {
  if (decoded.byteLength > maxFixtureBytes) {
    throw new Error(
      `benchmark fixture exceeds decoded byte limit: ${entry.caseId} (${decoded.byteLength} > ${maxFixtureBytes})`,
    );
  }
  return decoded;
}

function decodeFixture(
  entry: TranscriptBenchmarkFixtureManifestEntry,
  stored: Uint8Array,
  maxFixtureBytes: number,
): Uint8Array {
  const storageEncoding = entry.storageEncoding ?? 'raw';
  if (storageEncoding === 'raw') return stored;

  const decodedStorage = decodeCanonicalBase64(entry, stored);
  if (storageEncoding === 'base64') {
    return assertDecodedBound(entry, decodedStorage, maxFixtureBytes);
  }

  try {
    return gunzipSync(decodedStorage, { maxOutputLength: maxFixtureBytes });
  } catch (error) {
    throw new Error(`benchmark fixture gzip decode failed: ${entry.caseId}`, { cause: error });
  }
}

function chunkPcmFixture(
  entry: TranscriptBenchmarkFixtureManifestEntry,
  bytes: Uint8Array,
  chunkDurationMs: number,
): readonly TranscriptBenchmarkFixtureChunk[] {
  const frameBytes = bytesPerSample(entry) * entry.channels;
  if (frameBytes > MAX_TRANSCRIPT_BENCHMARK_CHUNK_BYTES) {
    throw new Error(`benchmark fixture audio frame exceeds chunk limit: ${entry.caseId}`);
  }
  if (bytes.byteLength === 0 || bytes.byteLength % frameBytes !== 0) {
    throw new Error(`benchmark fixture PCM byte length is invalid: ${entry.caseId}`);
  }

  const durationFrames = Math.max(1, Math.floor((entry.sampleRateHz * chunkDurationMs) / 1_000));
  const byteBoundFrames = Math.max(1, Math.floor(MAX_TRANSCRIPT_BENCHMARK_CHUNK_BYTES / frameBytes));
  const framesPerChunk = Math.min(durationFrames, byteBoundFrames);
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
  const maxFixtureBytes = normalizedMaxFixtureBytes(options.maxFixtureBytes);
  const absoluteManifestPath = resolve(manifestPath);
  const root = dirname(absoluteManifestPath);
  const manifest = parseManifest(await readFile(absoluteManifestPath, 'utf8'));
  assertTranscriptBenchmarkFixtureManifest(manifest, expectedCaseIds);

  const fixtures: TranscriptBenchmarkAudioFixture[] = [];
  for (const entry of manifest.entries) {
    const absoluteFixturePath = resolve(root, entry.path);
    assertInsideRoot(root, absoluteFixturePath, entry.caseId);

    const stored = await readBoundedFixture(
      absoluteFixturePath,
      entry.caseId,
      maxStoredFixtureBytes(entry, maxFixtureBytes),
    );
    const file = decodeFixture(entry, stored, maxFixtureBytes);
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
