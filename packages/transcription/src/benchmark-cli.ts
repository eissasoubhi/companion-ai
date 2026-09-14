import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import WebSocket, { type RawData } from 'ws';

import { loadBenchmarkAudioEvidenceFile } from './benchmark-audio-evidence-loader.js';
import { executeTranscriptBenchmarkBatch, serializeTranscriptBenchmarkBatchArtifact } from './benchmark-batch.js';
import { transcriptBenchmarkCorpus } from './benchmark-corpus.js';
import { loadTranscriptBenchmarkFixtureSet } from './benchmark-fixture-loader.js';
import type { TranscriptBenchmarkFixtureManifest } from './benchmark-fixture-manifest.js';
import { AssemblyAIUniversal35Provider, type AssemblyAISocket } from './providers/assemblyai.js';
import { DeepgramNova3Provider, type DeepgramSocket } from './providers/deepgram.js';
import { OpenAIGptLiveTranscribeProvider, type OpenAIRealtimeSocket } from './providers/openai.js';
import type { TranscriptionProvider } from './types.js';

export interface BenchmarkCliEnvironment {
  readonly DEEPGRAM_API_KEY?: string | undefined;
  readonly ASSEMBLYAI_API_KEY?: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
}

export interface BenchmarkCliOptions {
  readonly manifestPath: string;
  readonly evidencePath: string;
  readonly outputPath: string;
  readonly finalTimeoutMs?: number | undefined;
}

interface BenchmarkAudioFormat {
  readonly encoding: 'pcm-s16le';
  readonly sampleRateHz: number;
  readonly channels: 1;
}

function requiredSecret(environment: BenchmarkCliEnvironment, key: keyof BenchmarkCliEnvironment): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required to run the live STT benchmark`);
  return value;
}

export function assertBenchmarkProviderAudioFormat(
  manifest: TranscriptBenchmarkFixtureManifest,
): BenchmarkAudioFormat {
  const first = manifest.entries[0];
  if (!first) throw new Error('benchmark fixture manifest must contain at least one entry');

  if (first.encoding !== 'pcm-s16le' || first.channels !== 1) {
    throw new Error('live provider benchmark requires mono pcm-s16le fixtures');
  }

  for (const entry of manifest.entries) {
    if (
      entry.encoding !== first.encoding ||
      entry.sampleRateHz !== first.sampleRateHz ||
      entry.channels !== first.channels
    ) {
      throw new Error(`live provider benchmark requires one audio format across all fixtures: ${entry.caseId}`);
    }
  }

  return { encoding: 'pcm-s16le', sampleRateHz: first.sampleRateHz, channels: 1 };
}

function normalizeMessageData(data: RawData): string | Uint8Array {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const length = data.reduce((total, part) => total + part.byteLength, 0);
    const combined = new Uint8Array(length);
    let offset = 0;
    for (const part of data) {
      combined.set(part, offset);
      offset += part.byteLength;
    }
    return combined;
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function createSocket(url: string, headers: Readonly<Record<string, string>>): WebSocket {
  return new WebSocket(url, { headers: { ...headers } });
}

function wrapBinarySocket(socket: WebSocket): DeepgramSocket & AssemblyAISocket {
  return {
    send(data) {
      socket.send(data);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    onOpen(handler) {
      socket.on('open', handler);
    },
    onMessage(handler) {
      socket.on('message', (data) => handler({ data: normalizeMessageData(data) }));
    },
    onError(handler) {
      socket.on('error', handler);
    },
    onClose(handler) {
      socket.on('close', (code, reason) => handler({ code, reason: reason.toString() }));
    },
  };
}

function wrapTextSocket(socket: WebSocket): OpenAIRealtimeSocket {
  return {
    send(data) {
      socket.send(data);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    onOpen(handler) {
      socket.on('open', handler);
    },
    onMessage(handler) {
      socket.on('message', (data) => handler({ data: normalizeMessageData(data) }));
    },
    onError(handler) {
      socket.on('error', handler);
    },
    onClose(handler) {
      socket.on('close', (code, reason) => handler({ code, reason: reason.toString() }));
    },
  };
}

export function createLiveBenchmarkProviders(
  environment: BenchmarkCliEnvironment,
  format: BenchmarkAudioFormat,
): readonly TranscriptionProvider[] {
  const deepgramKey = requiredSecret(environment, 'DEEPGRAM_API_KEY');
  const assemblyAIKey = requiredSecret(environment, 'ASSEMBLYAI_API_KEY');
  const openAIKey = requiredSecret(environment, 'OPENAI_API_KEY');

  return [
    new DeepgramNova3Provider({
      audioFormat: format,
      createSocket: (url) => wrapBinarySocket(createSocket(url, { Authorization: `Token ${deepgramKey}` })),
    }),
    new AssemblyAIUniversal35Provider({
      sampleRateHz: format.sampleRateHz,
      createSocket: (url) => wrapBinarySocket(createSocket(url, { Authorization: assemblyAIKey })),
    }),
    new OpenAIGptLiveTranscribeProvider({
      sampleRateHz: format.sampleRateHz,
      createSocket: (url) => wrapTextSocket(createSocket(url, { Authorization: `Bearer ${openAIKey}` })),
    }),
  ];
}

export function parseBenchmarkCliArgs(args: readonly string[]): BenchmarkCliOptions {
  const [manifestPath, evidencePath, outputPath, ...rest] = args;
  if (!manifestPath || !evidencePath || !outputPath || rest.length > 1) {
    throw new Error('usage: benchmark:stt <manifest.json> <audio-evidence.json> <output.json> [final-timeout-ms]');
  }

  const finalTimeoutMs = rest[0] === undefined ? undefined : Number(rest[0]);
  if (finalTimeoutMs !== undefined && (!Number.isFinite(finalTimeoutMs) || finalTimeoutMs <= 0)) {
    throw new RangeError('final-timeout-ms must be a positive finite number');
  }

  return {
    manifestPath: resolve(manifestPath),
    evidencePath: resolve(evidencePath),
    outputPath: resolve(outputPath),
    ...(finalTimeoutMs === undefined ? {} : { finalTimeoutMs }),
  };
}

export async function runBenchmarkCli(
  options: BenchmarkCliOptions,
  environment: BenchmarkCliEnvironment = process.env,
): Promise<void> {
  const caseIds = transcriptBenchmarkCorpus.map((sample) => sample.id);
  const audioEvidence = await loadBenchmarkAudioEvidenceFile(options.evidencePath);
  const fixtureSet = await loadTranscriptBenchmarkFixtureSet(options.manifestPath, caseIds, { audioEvidence });
  const format = assertBenchmarkProviderAudioFormat(fixtureSet.manifest);
  const providers = createLiveBenchmarkProviders(environment, format);
  const result = await executeTranscriptBenchmarkBatch(providers, transcriptBenchmarkCorpus, fixtureSet, {
    ...(options.finalTimeoutMs === undefined ? {} : { finalTimeoutMs: options.finalTimeoutMs }),
  });

  await writeFile(options.outputPath, serializeTranscriptBenchmarkBatchArtifact(result), {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function main(): Promise<void> {
  await runBenchmarkCli(parseBenchmarkCliArgs(process.argv.slice(2)));
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryHref === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
