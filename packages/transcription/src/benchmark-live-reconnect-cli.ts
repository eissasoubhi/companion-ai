import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import WebSocket, { type RawData } from 'ws';

import {
  createAssemblyAIReconnectScenarioExecutor,
  createDeepgramReconnectScenarioExecutor,
  createOpenAIReconnectScenarioExecutor,
} from './benchmark-provider-reconnect.js';
import type { AssemblyAISocket, AssemblyAIProviderConfig } from './providers/assemblyai.js';
import type { DeepgramSocket, DeepgramProviderConfig } from './providers/deepgram.js';
import type { OpenAILiveTranscriptionConfig, OpenAIRealtimeSocket } from './providers/openai.js';
import type { TranscriptionConnectRequest } from './types.js';

export interface LiveReconnectEnvironment {
  readonly DEEPGRAM_API_KEY?: string | undefined;
  readonly ASSEMBLYAI_API_KEY?: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
}

export interface LiveReconnectCliOptions {
  readonly outputPath: string;
  readonly sampleRateHz: number;
  readonly timeoutMs?: number | undefined;
}

interface LiveReconnectResult {
  readonly schemaVersion: 1;
  readonly measuredAt: string;
  readonly source: 'remote';
  readonly sampleRateHz: number;
  readonly measurements: readonly {
    readonly providerId: string;
    readonly disconnectedAtMs: number;
    readonly recoveredAtMs: number | null;
    readonly recoveryMs: number | null;
  }[];
}

function requiredSecret(environment: LiveReconnectEnvironment, key: keyof LiveReconnectEnvironment): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required to run the live STT reconnect benchmark`);
  return value;
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
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onOpen: (handler) => socket.on('open', handler),
    onMessage: (handler) => socket.on('message', (data) => handler({ data: normalizeMessageData(data) })),
    onError: (handler) => socket.on('error', handler),
    onClose: (handler) => socket.on('close', (code, reason) => handler({ code, reason: reason.toString() })),
  };
}

function wrapTextSocket(socket: WebSocket): OpenAIRealtimeSocket {
  return {
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onOpen: (handler) => socket.on('open', handler),
    onMessage: (handler) => socket.on('message', (data) => handler({ data: normalizeMessageData(data) })),
    onError: (handler) => socket.on('error', handler),
    onClose: (handler) => socket.on('close', (code, reason) => handler({ code, reason: reason.toString() })),
  };
}

export function createLiveReconnectProviderConfigs(
  environment: LiveReconnectEnvironment,
  sampleRateHz: number,
): {
  readonly deepgram: DeepgramProviderConfig;
  readonly assemblyAI: AssemblyAIProviderConfig;
  readonly openAI: OpenAILiveTranscriptionConfig;
} {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError('sample-rate-hz must be a positive finite number');
  }
  const deepgramKey = requiredSecret(environment, 'DEEPGRAM_API_KEY');
  const assemblyAIKey = requiredSecret(environment, 'ASSEMBLYAI_API_KEY');
  const openAIKey = requiredSecret(environment, 'OPENAI_API_KEY');

  return {
    deepgram: {
      audioFormat: { encoding: 'pcm-s16le', sampleRateHz, channels: 1 },
      createSocket: (url) => wrapBinarySocket(createSocket(url, { Authorization: `Token ${deepgramKey}` })),
    },
    assemblyAI: {
      sampleRateHz,
      createSocket: (url) => wrapBinarySocket(createSocket(url, { Authorization: assemblyAIKey })),
    },
    openAI: {
      sampleRateHz,
      createSocket: (url) => wrapTextSocket(createSocket(url, { Authorization: `Bearer ${openAIKey}` })),
    },
  };
}

export function parseLiveReconnectCliArgs(args: readonly string[]): LiveReconnectCliOptions {
  const [outputPath, sampleRateArg, timeoutArg, ...rest] = args;
  if (!outputPath || !sampleRateArg || rest.length > 0) {
    throw new Error('usage: benchmark:stt:reconnect <output.json> <sample-rate-hz> [timeout-ms]');
  }
  const sampleRateHz = Number(sampleRateArg);
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError('sample-rate-hz must be a positive finite number');
  }
  const timeoutMs = timeoutArg === undefined ? undefined : Number(timeoutArg);
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new RangeError('timeout-ms must be a positive finite number');
  }
  return {
    outputPath: resolve(outputPath),
    sampleRateHz,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export async function runLiveReconnectCli(
  options: LiveReconnectCliOptions,
  environment: LiveReconnectEnvironment = process.env,
): Promise<void> {
  const configs = createLiveReconnectProviderConfigs(environment, options.sampleRateHz);
  const request: TranscriptionConnectRequest = {
    sessionId: 'live-reconnect-benchmark',
    source: 'remote',
    partialResults: true,
  };
  const executorOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  const executors = [
    createDeepgramReconnectScenarioExecutor(configs.deepgram, request, executorOptions),
    createAssemblyAIReconnectScenarioExecutor(configs.assemblyAI, request, executorOptions),
    createOpenAIReconnectScenarioExecutor(configs.openAI, request, executorOptions),
  ] as const;

  const measurements = [] as Array<LiveReconnectResult['measurements'][number]>;
  for (const executor of executors) {
    const measurement = await executor.measureReconnect('controlled-disconnect');
    measurements.push({
      providerId: executor.providerId,
      disconnectedAtMs: measurement.disconnectedAtMs,
      recoveredAtMs: measurement.recoveredAtMs,
      recoveryMs:
        measurement.recoveredAtMs === null
          ? null
          : measurement.recoveredAtMs - measurement.disconnectedAtMs,
    });
  }

  const result: LiveReconnectResult = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    source: 'remote',
    sampleRateHz: options.sampleRateHz,
    measurements,
  };
  await writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function main(): Promise<void> {
  await runLiveReconnectCli(parseLiveReconnectCliArgs(process.argv.slice(2)));
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryHref === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
