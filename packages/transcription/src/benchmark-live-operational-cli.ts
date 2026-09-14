import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadTranscriptBenchmarkFixtureSet } from './benchmark-fixture-loader.js';
import {
  createAssemblyAIOperationalScenarioExecutor,
  createDeepgramOperationalScenarioExecutor,
  createOpenAIOperationalScenarioExecutor,
  type TranscriptOperationalAudioFixtures,
} from './benchmark-provider-operational.js';
import { createLiveReconnectProviderConfigs, type LiveReconnectEnvironment } from './benchmark-live-reconnect-cli.js';
import { runTranscriptOperationalScenarios } from './benchmark-operational-runner.js';
import type { TranscriptBenchmarkAudioFixture, TranscriptBenchmarkFixtureChunk } from './benchmark-execution.js';
import type { AudioChunk, TranscriptionConnectRequest } from './types.js';

export interface LiveOperationalCliOptions {
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly benchmarkRunId: string;
  readonly endpointCaseId: string;
  readonly pauseBeforeCaseId: string;
  readonly pauseAfterCaseId: string;
  readonly pauseMs: number;
  readonly timeoutMs?: number | undefined;
}

function canonicalId(value: string, field: string): string {
  if (value.length === 0 || value.trim() !== value) throw new Error(`${field} must be a non-empty canonical identifier`);
  return value;
}

function positiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${field} must be a positive finite number`);
  return value;
}

function bytesPerSample(encoding: TranscriptBenchmarkFixtureChunk['encoding']): number {
  if (encoding === 'pcm-s16le') return 2;
  if (encoding === 'pcm-f32le') return 4;
  throw new Error('live operational benchmark requires PCM fixtures');
}

function fixtureEndAtMs(fixture: TranscriptBenchmarkAudioFixture): number {
  const last = fixture.chunks.at(-1);
  if (!last) throw new Error(`benchmark fixture has no audio chunks: ${fixture.caseId}`);
  const frameBytes = bytesPerSample(last.encoding) * last.channels;
  if (last.data.byteLength === 0 || last.data.byteLength % frameBytes !== 0) throw new Error(`benchmark fixture PCM byte length is invalid: ${fixture.caseId}`);
  return last.capturedAtMs + (last.data.byteLength / frameBytes / last.sampleRateHz) * 1_000;
}

function toAudioChunks(fixture: TranscriptBenchmarkAudioFixture, sessionId: string, sequenceOffset = 0): readonly AudioChunk[] {
  return fixture.chunks.map((chunk, index) => ({ ...chunk, sequence: sequenceOffset + index, sessionId, source: fixture.source }));
}

function assertCompatibleFixtures(left: TranscriptBenchmarkAudioFixture, right: TranscriptBenchmarkAudioFixture): void {
  const leftFirst = left.chunks[0];
  const rightFirst = right.chunks[0];
  if (!leftFirst || !rightFirst) throw new Error('operational fixtures must contain audio chunks');
  if (left.source !== right.source || leftFirst.encoding !== rightFirst.encoding || leftFirst.sampleRateHz !== rightFirst.sampleRateHz || leftFirst.channels !== rightFirst.channels) {
    throw new Error('operational fixtures must share source and audio format');
  }
}

export function buildTranscriptOperationalAudioFixtures(endpoint: TranscriptBenchmarkAudioFixture, pauseBefore: TranscriptBenchmarkAudioFixture, pauseAfter: TranscriptBenchmarkAudioFixture, pauseMs: number): TranscriptOperationalAudioFixtures {
  positiveFinite(pauseMs, 'pauseMs');
  assertCompatibleFixtures(endpoint, pauseBefore);
  assertCompatibleFixtures(pauseBefore, pauseAfter);
  const endpointSessionId = `operational:endpoint:${canonicalId(endpoint.caseId, 'endpointCaseId')}`;
  const pauseSessionId = `operational:pause:${canonicalId(pauseBefore.caseId, 'pauseBeforeCaseId')}:${canonicalId(pauseAfter.caseId, 'pauseAfterCaseId')}`;
  const beforeChunks = toAudioChunks(pauseBefore, pauseSessionId);
  return {
    endpointFinalization: { chunks: toAudioChunks(endpoint, endpointSessionId), audioEndedAtMs: fixtureEndAtMs(endpoint) },
    falseFinalization: {
      beforePauseChunks: beforeChunks,
      afterPauseChunks: toAudioChunks(pauseAfter, pauseSessionId, beforeChunks.length),
      pauseMs,
    },
  };
}

export function parseLiveOperationalCliArgs(args: readonly string[]): LiveOperationalCliOptions {
  const [manifestPath, outputPath, benchmarkRunId, endpointCaseId, pauseBeforeCaseId, pauseAfterCaseId, pauseArg, timeoutArg, ...rest] = args;
  if (!manifestPath || !outputPath || !benchmarkRunId || !endpointCaseId || !pauseBeforeCaseId || !pauseAfterCaseId || !pauseArg || rest.length > 0) throw new Error('usage: benchmark:stt:operational <manifest.json> <output.json> <benchmark-run-id> <endpoint-case-id> <pause-before-case-id> <pause-after-case-id> <pause-ms> [timeout-ms]');
  const pauseMs = positiveFinite(Number(pauseArg), 'pause-ms');
  const timeoutMs = timeoutArg === undefined ? undefined : positiveFinite(Number(timeoutArg), 'timeout-ms');
  return {
    manifestPath: resolve(manifestPath), outputPath: resolve(outputPath), benchmarkRunId: canonicalId(benchmarkRunId, 'benchmark-run-id'),
    endpointCaseId: canonicalId(endpointCaseId, 'endpoint-case-id'), pauseBeforeCaseId: canonicalId(pauseBeforeCaseId, 'pause-before-case-id'),
    pauseAfterCaseId: canonicalId(pauseAfterCaseId, 'pause-after-case-id'), pauseMs, ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export async function runLiveOperationalCli(options: LiveOperationalCliOptions, environment: LiveReconnectEnvironment = process.env): Promise<void> {
  const expectedCaseIds = [options.endpointCaseId, options.pauseBeforeCaseId, options.pauseAfterCaseId];
  const loaded = await loadTranscriptBenchmarkFixtureSet(options.manifestPath, expectedCaseIds);
  const byId = new Map(loaded.fixtures.map((fixture) => [fixture.caseId, fixture]));
  const endpoint = byId.get(options.endpointCaseId); const pauseBefore = byId.get(options.pauseBeforeCaseId); const pauseAfter = byId.get(options.pauseAfterCaseId);
  if (!endpoint || !pauseBefore || !pauseAfter) throw new Error('operational benchmark fixtures are incomplete');
  const firstChunk = endpoint.chunks[0];
  if (!firstChunk) throw new Error(`benchmark fixture has no audio chunks: ${endpoint.caseId}`);
  const fixtures = buildTranscriptOperationalAudioFixtures(endpoint, pauseBefore, pauseAfter, options.pauseMs);
  const configs = createLiveReconnectProviderConfigs(environment, firstChunk.sampleRateHz);
  const request: TranscriptionConnectRequest = { sessionId: 'live-operational-benchmark', source: endpoint.source, partialResults: true };
  const executorOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  const executors = [
    createDeepgramOperationalScenarioExecutor(configs.deepgram, request, fixtures, executorOptions),
    createAssemblyAIOperationalScenarioExecutor(configs.assemblyAI, request, fixtures, executorOptions),
    createOpenAIOperationalScenarioExecutor(configs.openAI, request, fixtures, executorOptions),
  ] as const;
  const scenarios = [
    { scenarioId: 'endpoint-finalization', kind: 'endpoint-finalization' as const },
    { scenarioId: 'controlled-reconnect', kind: 'reconnect' as const },
    { scenarioId: 'pause-false-finalization', kind: 'false-finalization' as const },
  ];
  const artifacts = [];
  for (const executor of executors) {
    const result = await runTranscriptOperationalScenarios({ benchmarkRunId: options.benchmarkRunId, corpusVersion: loaded.manifest.corpusVersion, providerId: executor.providerId, scenarios, executor });
    artifacts.push(result.artifact);
  }
  await writeFile(options.outputPath, `${JSON.stringify({ schemaVersion: 1, fixtureSetId: loaded.manifest.fixtureSetId, corpusVersion: loaded.manifest.corpusVersion, artifacts }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function main(): Promise<void> { await runLiveOperationalCli(parseLiveOperationalCliArgs(process.argv.slice(2))); }
const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryHref === import.meta.url) main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
