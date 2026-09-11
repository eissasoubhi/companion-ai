import { detectAudioSignal } from './audio-signal.js';

export type SystemAudioDiagnosticState =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'blocked'
  | 'error';

export interface SystemAudioDiagnosticResult {
  readonly state: Exclude<SystemAudioDiagnosticState, 'idle' | 'checking'>;
  readonly signalDetected?: boolean | undefined;
  readonly message: string;
  readonly action?: string | undefined;
}

interface SystemAudioDependencies {
  readonly getCapability: () => Promise<SystemAudioCapability>;
  readonly getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
  readonly createAudioContext: () => AudioContext;
}

function defaultDependencies(): SystemAudioDependencies {
  return {
    getCapability: () => window.companion.systemAudio.getCapability(),
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
    createAudioContext: () => new AudioContext(),
  };
}

export function describeSystemAudioError(error: unknown): SystemAudioDiagnosticResult {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return {
          state: 'blocked',
          message: 'System audio capture was cancelled or denied.',
          action:
            'Run diagnostics again, approve the macOS sharing prompt and include system audio in the selected source.',
        };
      case 'NotFoundError':
        return {
          state: 'blocked',
          message: 'No shareable desktop source was available.',
          action: 'Make sure a screen or window is available, then run diagnostics again.',
        };
      case 'AbortError':
        return {
          state: 'error',
          message: 'System audio capture stopped before the diagnostic completed.',
          action: 'Run diagnostics again and keep the selected source shared until the check finishes.',
        };
    }
  }

  return {
    state: 'error',
    message: 'The system audio diagnostic failed unexpectedly.',
    action: 'Run diagnostics again. If it persists, inspect the diagnostic logs.',
  };
}

export async function runSystemAudioDiagnostic(
  dependencies: SystemAudioDependencies = defaultDependencies(),
): Promise<SystemAudioDiagnosticResult> {
  try {
    const capability = await dependencies.getCapability();

    if (!capability.supported) {
      return {
        state: 'blocked',
        message: capability.reason ?? 'System audio capture is not supported by this build.',
        action:
          capability.platform === 'darwin'
            ? 'Use macOS 15 or later for the current native system-audio capture path.'
            : 'System audio support for this platform is planned after the macOS P0 path is validated.',
      };
    }

    const stream = await dependencies.getDisplayMedia({
      audio: true,
      video: true,
    });

    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== 'live') {
        return {
          state: 'blocked',
          message: 'The selected source did not provide a live system-audio track.',
          action:
            'Run diagnostics again and choose a source with system audio enabled in the macOS sharing picker.',
        };
      }

      const signalDetected = await detectAudioSignal(
        stream,
        dependencies.createAudioContext,
        { durationMs: 1_200 },
      );

      if (!signalDetected) {
        return {
          state: 'blocked',
          signalDetected: false,
          message: 'A system-audio track opened, but no audio samples were detected.',
          action:
            'Play audible media in another app, then run diagnostics again and confirm system audio is included in the macOS picker.',
        };
      }

      return {
        state: 'ready',
        signalDetected: true,
        message: 'System audio opened successfully and a live audio signal was detected.',
      };
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  } catch (error) {
    return describeSystemAudioError(error);
  }
}
