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
  readonly cleanupTimeoutMs?: number | undefined;
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

const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000;
const MAX_CLEANUP_TIMEOUT_MS = 10_000;

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

function assertLiveAudioTrack(stream: MediaStream, source: LiveAudioSource): void {
  const track = stream.getAudioTracks().find((candidate) => candidate.readyState === 'live');
  if (!track) {
    stopRawStream(stream);
    throw new Error(`No live ${source} audio track is available after capture.`);
  }
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

function normalizedCleanupTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_CLEANUP_TIMEOUT_MS
  ) {
    throw new RangeError(
      `cleanupTimeoutMs must be a finite number between 1 and ${MAX_CLEANUP_TIMEOUT_MS}.`,
    );
  }
  return timeoutMs;
}

async function runBoundedCleanup(
  action: () => Promise<unknown>,
  label: string,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(action),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function startCaptureSession(
  options: CaptureSessionOptions = {},
  dependencies: CaptureSessionDependencies = defaultDependencies(),
): Promise<CaptureSessionHandle> {
  const cleanupTimeoutMs = normalizedCleanupTimeoutMs(options.cleanupTimeoutMs);
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

      if (localHandle) {
        operations.push(
          runBoundedCleanup(() => localHandle!.stop(), 'Local capture cleanup', cleanupTimeoutMs),
        );
      } else {
        stopRawStream(localStream);
      }

      if (remoteHandle) {
        operations.push(
          runBoundedCleanup(() => remoteHandle!.stop(), 'Remote capture cleanup', cleanupTimeoutMs),
        );
      } else {
        stopRawStream(remoteStream);
      }

      if (transcriptionStarted) {
        operations.push(
          runBoundedCleanup(
            () => dependencies.stopTranscription(),
            'Transcription cleanup',
            cleanupTimeoutMs,
          ),
        );
      }

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
    try {
      options.onDegraded?.(source, reason, error);
    } catch {
      // Diagnostics callbacks must never prevent fail-closed capture cleanup.
    }

    if (!ready) {
      degradedDuringStartup = { source, reason };
      return;
    }

    void stop().catch(() => undefined);
  };

  try {
    localStream = await runStartupStage(
      'microphone-capture',
      async () => {
        const stream = await dependencies.getUserMedia({ audio: true, video: false });
        assertLiveAudioTrack(stream, 'local');
        return stream;
      },
    );
    remoteStream = await runStartupStage(
      'remote-capture',
      async () => {
        const stream = await dependencies.getDisplayMedia({ audio: true, video: true });
        assertLiveAudioTrack(stream, 'remote');
        return stream;
      },
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
