import type { AudioChunk, TranscriptionPipelineEvent, TranscriptionProvider } from './types.js';
import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';
import {
  summarizeTranscriptBenchmarkRun,
  type TranscriptBenchmarkObservation,
  type TranscriptBenchmarkRunReport,
} from './benchmark-runner.js';
import { TranscriptionChannel, type TranscriptionClock } from './channel.js';

export type TranscriptBenchmarkFixtureChunk = Omit<AudioChunk, 'sessionId' | 'source'>;

export interface TranscriptBenchmarkAudioFixture {
  readonly caseId: string;
  readonly source: AudioChunk['source'];
  readonly chunks: readonly TranscriptBenchmarkFixtureChunk[];
}

export interface TranscriptBenchmarkExecutionOptions {
  readonly sessionIdPrefix?: string | undefined;
  readonly finalTimeoutMs?: number | undefined;
  readonly clock?: TranscriptionClock | undefined;
}

export interface TranscriptBenchmarkExecutionResult {
  readonly providerId: string;
  readonly observations: readonly TranscriptBenchmarkObservation[];
  readonly report: TranscriptBenchmarkRunReport;
}

const DEFAULT_FINAL_TIMEOUT_MS = 8_000;

function assertFixtureSet(
  corpus: readonly TranscriptBenchmarkCorpusCase[],
  fixtures: readonly TranscriptBenchmarkAudioFixture[],
): void {
  const corpusIds = new Set(corpus.map((sample) => sample.id));
  const fixtureIds = new Set<string>();

  for (const fixture of fixtures) {
    if (!corpusIds.has(fixture.caseId)) {
      throw new Error(`unknown benchmark fixture: ${fixture.caseId}`);
    }
    if (fixtureIds.has(fixture.caseId)) {
      throw new Error(`duplicate benchmark fixture: ${fixture.caseId}`);
    }
    fixtureIds.add(fixture.caseId);

    if (fixture.chunks.length === 0) {
      throw new Error(`benchmark fixture has no audio chunks: ${fixture.caseId}`);
    }

    let previousSequence = -1;
    for (const chunk of fixture.chunks) {
      if (!Number.isInteger(chunk.sequence) || chunk.sequence <= previousSequence) {
        throw new RangeError(
          `benchmark fixture chunk sequence must increase monotonically: ${fixture.caseId}`,
        );
      }
      previousSequence = chunk.sequence;
    }
  }

  for (const sample of corpus) {
    if (!fixtureIds.has(sample.id)) {
      throw new Error(`missing benchmark fixture: ${sample.id}`);
    }
  }
}

function normalizedTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_FINAL_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('finalTimeoutMs must be a positive finite number');
  }
  return timeoutMs;
}

async function executeFixture(
  provider: TranscriptionProvider,
  fixture: TranscriptBenchmarkAudioFixture,
  sessionId: string,
  finalTimeoutMs: number,
  clock: TranscriptionClock,
): Promise<TranscriptBenchmarkObservation> {
  const finalTexts: string[] = [];
  const latencySamples: TranscriptBenchmarkObservation['latencySamples'] extends readonly (infer T)[]
    ? T[]
    : never = [];
  let resolveFinal: (() => void) | undefined;
  let rejectFinal: ((error: Error) => void) | undefined;
  let finalSettled = false;

  const finalReceived = new Promise<void>((resolve, reject) => {
    resolveFinal = resolve;
    rejectFinal = reject;
  });

  const settleFinal = (error?: Error): void => {
    if (finalSettled) return;
    finalSettled = true;
    if (error) rejectFinal?.(error);
    else resolveFinal?.();
  };

  const handleEvent = (event: TranscriptionPipelineEvent): void => {
    switch (event.type) {
      case 'transcript':
        latencySamples.push(event.latency);
        if (event.segment.isFinal) {
          finalTexts.push(event.segment.text);
          settleFinal();
        }
        return;
      case 'provider-error':
        settleFinal(
          new Error(
            `${provider.id} benchmark failed for ${fixture.caseId}: ${event.code}: ${event.message}`,
          ),
        );
        return;
      case 'provider-closed':
        if (finalTexts.length === 0) {
          settleFinal(
            new Error(`${provider.id} benchmark closed before a final transcript: ${fixture.caseId}`),
          );
        }
        return;
      case 'provider-ready':
        return;
    }
  };

  const channel = await TranscriptionChannel.open(
    provider,
    {
      sessionId,
      source: fixture.source,
      partialResults: true,
    },
    handleEvent,
    clock,
  );

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closeStarted = false;
  try {
    for (const chunk of fixture.chunks) {
      await channel.writeAudio({
        ...chunk,
        sessionId,
        source: fixture.source,
      });
    }

    const timedFinal = Promise.race([
      finalReceived,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `${provider.id} benchmark timed out waiting for a final transcript: ${fixture.caseId}`,
            ),
          );
        }, finalTimeoutMs);
      }),
    ]);

    closeStarted = true;
    const closePromise = channel.close();
    await timedFinal;
    await closePromise;

    if (finalTexts.length === 0) {
      throw new Error(`${provider.id} benchmark produced no final transcript: ${fixture.caseId}`);
    }

    return {
      caseId: fixture.caseId,
      hypothesis: finalTexts.join(' ').trim(),
      latencySamples,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!closeStarted) await channel.close();
  }
}

export async function executeTranscriptBenchmarkRun(
  provider: TranscriptionProvider,
  corpus: readonly TranscriptBenchmarkCorpusCase[],
  fixtures: readonly TranscriptBenchmarkAudioFixture[],
  options: TranscriptBenchmarkExecutionOptions = {},
): Promise<TranscriptBenchmarkExecutionResult> {
  if (provider.id.trim().length === 0) {
    throw new Error('provider id must not be empty');
  }

  assertFixtureSet(corpus, fixtures);
  const finalTimeoutMs = normalizedTimeoutMs(options.finalTimeoutMs);
  const sessionIdPrefix = options.sessionIdPrefix?.trim() || 'benchmark';
  const clock = options.clock ?? (() => Date.now());
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.caseId, fixture]));
  const observations: TranscriptBenchmarkObservation[] = [];

  for (const sample of corpus) {
    const fixture = fixturesById.get(sample.id);
    if (!fixture) {
      throw new Error(`missing benchmark fixture: ${sample.id}`);
    }
    observations.push(
      await executeFixture(
        provider,
        fixture,
        `${sessionIdPrefix}:${provider.id}:${sample.id}`,
        finalTimeoutMs,
        clock,
      ),
    );
  }

  return {
    providerId: provider.id,
    observations,
    report: summarizeTranscriptBenchmarkRun({
      providerId: provider.id,
      corpus,
      observations,
    }),
  };
}
