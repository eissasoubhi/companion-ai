import {
  startLiveAudioStream,
  type LiveAudioSource,
  type LiveAudioStreamHandle,
  type LiveAudioStreamOptions,
} from './live-audio-stream.js';

export type CaptureSessionDegradedReason = 'track-ended' | 'write-failed';
export type CaptureStartupStage =
  | 'microphone-capture'
  | 'remote-capture'
  | 'transcription'
  | 'local-stream'
  | 'remote-stream';

export interface CaptureStartupMetric {
  readonly stage: CaptureStartupStage;
  readonly durationMs: number;
  readonly outcome: 'success' | 'failure';
}

export interface CaptureSessionOptions {
  readonly language?: string | undefined;
  readonly onDegraded?: (
    source: LiveAudioSource,
    reason: CaptureSessionDegradedReason,
    error?: unknown,
  ) => void;
  readonly onStartupMetric?: (metric: CaptureStartupMetric) => void;
}

export interface CaptureSessionHandle {
  readonly sessionId: string;
  readonly local: LiveAudioStreamHandle;
  readonly remote: LiveAudioStreamHandle;
  stop(): Promise<void>;
}

interface CaptureSessionDependencies {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
  readonly startTranscription: (
    options?: { readonly language?: string | undefined },
  ) => Promise<{ sessionId: string }>;
  readonly stopTranscription: () => Promise<void>;
  readonly startLiveAudioStream: (
    options: LiveAudioStreamOptions,
  ) => Promise<LiveAudioStreamHandle>;
  readonly now?: () => number;
}

function defaultDependencies(): CaptureSessionDependencies {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
    startTranscription: (options) => window.companion.transcription.start(options),
    stopTranscription: () => window.companion.transcription.stop(),
    startLiveAudioStream: (options) => startLiveAudioStream(options),
    now: () => performance.now(),
  };
}

function stopRawStream(stream: MediaStream | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function firstRejectedReason(results: readonly PromiseSettledResult<unknown>[]): unknown | undefined {
  return results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )?.reason;
}

function degradedStartupError(
  source: LiveAudioSource,
  reason: CaptureSessionDegradedReason,
): Error {
  return new Error(`Capture degraded during startup (${source}: ${reason})`);
}

function safeDuration(startedAt: number, finishedAt: number): number {
  const duration = finishedAt - startedAt;
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

export async function startCaptureSession(
  options: CaptureSessionOptions = {},
  dependencies: CaptureSessionDependencies = defaultDependencies(),
): Promise<CaptureSessionHandle> {
  let localStream: MediaStream | undefined;
  let remoteStream: MediaStream | undefined;
  let localHandle: LiveAudioStreamHandle | undefined;
  let remoteHandle: LiveAudioStreamHandle | undefined;
  let transcriptionStarted = false;
  let ready = false;
  let degradationHandled = false;
  let degradedDuringStartup:
    | { readonly source: LiveAudioSource; readonly reason: CaptureSessionDegradedReason }
    | undefined;
  let stopping: Promise<void> | undefined;
  const now = dependencies.now ?? (() => performance.now());

  const emitStartupMetric = (metric: CaptureStartupMetric): void => {
    try {
      options.onStartupMetric?.(metric);
    } catch {
      // Diagnostics must never break live capture startup.
    }
  };

  const runStartupStage = async <T>(
    stage: CaptureStartupStage,
    action: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = now();
    try {
      const result = await action();
      emitStartupMetric({
        stage,
        durationMs: safeDuration(startedAt, now()),
        outcome: 'success',
      });
      return result;
    } catch (error) {
      emitStartupMetric({
        stage,
        durationMs: safeDuration(startedAt, now()),
        outcome: 'failure',
      });
      throw error;
    }
  };

  const stop = (): Promise<void> => {
    if (stopping) return stopping;

    stopping = (async () => {
      const operations: Promise<unknown>[] = [];

      if (localHandle) operations.push(localHandle.stop());
      else stopRawStream(localStream);

      if (remoteHandle) operations.push(remoteHandle.stop());
      else stopRawStream(remoteStream);

      if (transcriptionStarted) operations.push(dependencies.stopTranscription());

      const results = await Promise.allSettled(operations);
      const error = firstRejectedReason(results);
      if (error !== undefined) throw error;
    })();

    return stopping;
  };

  const onDegraded = (
    source: LiveAudioSource,
    reason: CaptureSessionDegradedReason,
    error?: unknown,
  ): void => {
    if (degradationHandled) return;
    degradationHandled = true;
    options.onDegraded?.(source, reason, error);

    if (!ready) {
      degradedDuringStartup = { source, reason };
      return;
    }

    void stop().catch(() => undefined);
  };

  try {
    localStream = await runStartupStage(
      'microphone-capture',
      () => dependencies.getUserMedia({ audio: true, video: false }),
    );
    remoteStream = await runStartupStage(
      'remote-capture',
      () => dependencies.getDisplayMedia({ audio: true, video: true }),
    );

    const transcriptionOptions = options.language === undefined
      ? undefined
      : { language: options.language };
    const { sessionId } = await runStartupStage(
      'transcription',
      () => dependencies.startTranscription(transcriptionOptions),
    );
    transcriptionStarted = true;

    localHandle = await runStartupStage(
      'local-stream',
      () => dependencies.startLiveAudioStream({
        stream: localStream!,
        source: 'local',
        sessionId,
        onDegraded: (reason, error) => onDegraded('local', reason, error),
      }),
    );

    remoteHandle = await runStartupStage(
      'remote-stream',
      () => dependencies.startLiveAudioStream({
        stream: remoteStream!,
        source: 'remote',
        sessionId,
        onDegraded: (reason, error) => onDegraded('remote', reason, error),
      }),
    );

    if (degradedDuringStartup) {
      await stop();
      throw degradedStartupError(
        degradedDuringStartup.source,
        degradedDuringStartup.reason,
      );
    }

    ready = true;

    return {
      sessionId,
      local: localHandle,
      remote: remoteHandle,
      stop,
    };
  } catch (error) {
    await Promise.allSettled([stop()]);
    throw error;
  }
}
