import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';
import {
  executeTranscriptBenchmarkRun,
  type TranscriptBenchmarkExecutionOptions,
  type TranscriptBenchmarkExecutionResult,
} from './benchmark-execution.js';
import type { LoadedTranscriptBenchmarkFixtureSet } from './benchmark-fixture-loader.js';
import type { TranscriptionProvider } from './types.js';

export const TRANSCRIPT_BENCHMARK_BATCH_ARTIFACT_VERSION = 1 as const;

export interface TranscriptBenchmarkBatchOptions extends TranscriptBenchmarkExecutionOptions {
  readonly sessionIdPrefix?: string | undefined;
}

export interface TranscriptBenchmarkBatchResult {
  readonly version: typeof TRANSCRIPT_BENCHMARK_BATCH_ARTIFACT_VERSION;
  readonly corpusVersion: string;
  readonly fixtureSetId: string;
  readonly caseIds: readonly string[];
  readonly providerIds: readonly string[];
  readonly runs: readonly TranscriptBenchmarkExecutionResult[];
}

function assertProviders(providers: readonly TranscriptionProvider[]): readonly string[] {
  if (providers.length === 0) {
    throw new Error('at least one transcription provider is required');
  }

  const providerIds: string[] = [];
  const seen = new Set<string>();

  for (const provider of providers) {
    const providerId = provider.id.trim();
    if (providerId.length === 0) {
      throw new Error('provider id must not be empty');
    }
    if (seen.has(providerId)) {
      throw new Error(`duplicate transcription provider id: ${providerId}`);
    }
    seen.add(providerId);
    providerIds.push(providerId);
  }

  return providerIds;
}

function assertCorpus(corpus: readonly TranscriptBenchmarkCorpusCase[]): readonly string[] {
  if (corpus.length === 0) {
    throw new Error('benchmark corpus must not be empty');
  }

  const caseIds: string[] = [];
  const seen = new Set<string>();
  for (const sample of corpus) {
    const caseId = sample.id.trim();
    if (caseId.length === 0) {
      throw new Error('benchmark corpus case id must not be empty');
    }
    if (seen.has(caseId)) {
      throw new Error(`duplicate benchmark corpus case id: ${caseId}`);
    }
    seen.add(caseId);
    caseIds.push(caseId);
  }
  return caseIds;
}

export async function executeTranscriptBenchmarkBatch(
  providers: readonly TranscriptionProvider[],
  corpus: readonly TranscriptBenchmarkCorpusCase[],
  fixtureSet: LoadedTranscriptBenchmarkFixtureSet,
  options: TranscriptBenchmarkBatchOptions = {},
): Promise<TranscriptBenchmarkBatchResult> {
  const providerIds = assertProviders(providers);
  const caseIds = assertCorpus(corpus);

  if (fixtureSet.manifest.corpusVersion.trim().length === 0) {
    throw new Error('benchmark fixture corpusVersion must not be empty');
  }
  if (fixtureSet.manifest.fixtureSetId.trim().length === 0) {
    throw new Error('benchmark fixture fixtureSetId must not be empty');
  }

  const sessionIdPrefix =
    options.sessionIdPrefix?.trim() || `benchmark:${fixtureSet.manifest.fixtureSetId}`;
  const runs: TranscriptBenchmarkExecutionResult[] = [];

  // Keep providers sequential so one provider cannot distort another provider's
  // latency through shared CPU/network contention on the benchmark machine.
  for (const provider of providers) {
    runs.push(
      await executeTranscriptBenchmarkRun(provider, corpus, fixtureSet.fixtures, {
        ...options,
        sessionIdPrefix,
      }),
    );
  }

  return {
    version: TRANSCRIPT_BENCHMARK_BATCH_ARTIFACT_VERSION,
    corpusVersion: fixtureSet.manifest.corpusVersion,
    fixtureSetId: fixtureSet.manifest.fixtureSetId,
    caseIds,
    providerIds,
    runs,
  };
}

export function serializeTranscriptBenchmarkBatchArtifact(
  result: TranscriptBenchmarkBatchResult,
): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
