import {
  startLiveAudioStream,
  type LiveAudioSource,
  type LiveAudioStreamHandle,
  type LiveAudioStreamOptions,
} from './live-audio-stream.js';

export type CaptureSessionDegradedReason = 'track-ended' | 'write-failed';

export interface CaptureSessionOptions {
  readonly language?: string | undefined;
  readonly onDegraded?: (
    source: LiveAudioSource,
    reason: CaptureSessionDegradedReason,
    error?: unknown,
  ) => void;
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
}

function defaultDependencies(): CaptureSessionDependencies {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
    startTranscription: (options) => window.companion.transcription.start(options),
    stopTranscription: () => window.companion.transcription.stop(),
    startLiveAudioStream: (options) => startLiveAudioStream(options),
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

export async function startCaptureSession(
  options: CaptureSessionOptions = {},
  dependencies: CaptureSessionDependencies = defaultDependencies(),
): Promise<CaptureSessionHandle> {
  let localStream: MediaStream | undefined;
  let remoteStream: MediaStream | undefined;
  let localHandle: LiveAudioStreamHandle | undefined;
  let remoteHandle: LiveAudioStreamHandle | undefined;
  let transcriptionStarted = false;

  try {
    localStream = await dependencies.getUserMedia({ audio: true, video: false });
    remoteStream = await dependencies.getDisplayMedia({ audio: true, video: true });

    const transcriptionOptions = options.language === undefined
      ? undefined
      : { language: options.language };
    const { sessionId } = await dependencies.startTranscription(transcriptionOptions);
    transcriptionStarted = true;

    localHandle = await dependencies.startLiveAudioStream({
      stream: localStream,
      source: 'local',
      sessionId,
      onDegraded: (reason, error) => options.onDegraded?.('local', reason, error),
    });

    remoteHandle = await dependencies.startLiveAudioStream({
      stream: remoteStream,
      source: 'remote',
      sessionId,
      onDegraded: (reason, error) => options.onDegraded?.('remote', reason, error),
    });

    let stopping: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      if (stopping) return stopping;

      stopping = (async () => {
        const results = await Promise.allSettled([
          localHandle?.stop() ?? Promise.resolve(),
          remoteHandle?.stop() ?? Promise.resolve(),
          dependencies.stopTranscription(),
        ]);
        const error = firstRejectedReason(results);
        if (error !== undefined) throw error;
      })();

      return stopping;
    };

    return {
      sessionId,
      local: localHandle,
      remote: remoteHandle,
      stop,
    };
  } catch (error) {
    const cleanup: Promise<unknown>[] = [];
    if (localHandle) cleanup.push(localHandle.stop());
    else stopRawStream(localStream);
    if (remoteHandle) cleanup.push(remoteHandle.stop());
    else stopRawStream(remoteStream);
    if (transcriptionStarted) cleanup.push(dependencies.stopTranscription());
    await Promise.allSettled(cleanup);
    throw error;
  }
}
