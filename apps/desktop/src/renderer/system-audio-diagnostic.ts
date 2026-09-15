import { detectAudioSignal } from './audio-signal.js';

export type SystemAudioDiagnosticState =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'blocked'
  | 'error';

export type SystemAudioCapabilityState = 'unknown' | 'supported' | 'unsupported';
export type SystemAudioCaptureState =
  | 'not-attempted'
  | 'denied'
  | 'unavailable'
  | 'no-audio-track'
  | 'no-signal'
  | 'verified'
  | 'failed';

export interface SystemAudioDiagnosticResult {
  readonly state: Exclude<SystemAudioDiagnosticState, 'idle' | 'checking'>;
  readonly capability: SystemAudioCapabilityState;
  readonly capture: SystemAudioCaptureState;
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

function stopDiagnosticStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Diagnostic cleanup is best-effort: one broken display track must not leak
      // the remaining tracks or replace an actionable diagnostic result.
    }
  }
}

export function describeSystemAudioError(
  error: unknown,
  capability: SystemAudioCapabilityState = 'unknown',
): SystemAudioDiagnosticResult {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return {
          state: 'blocked',
          capability,
          capture: 'denied',
          message: 'System audio capture was cancelled or denied.',
          action:
            'Run diagnostics again, approve the macOS sharing prompt and include system audio in the selected source.',
        };
      case 'NotFoundError':
        return {
          state: 'blocked',
          capability,
          capture: 'unavailable',
          message: 'No shareable desktop source was available.',
          action: 'Make sure a screen or window is available, then run diagnostics again.',
        };
      case 'AbortError':
        return {
          state: 'error',
          capability,
          capture: 'failed',
          message: 'System audio capture stopped before the diagnostic completed.',
          action: 'Run diagnostics again and keep the selected source shared until the check finishes.',
        };
    }
  }

  return {
    state: 'error',
    capability,
    capture: 'failed',
    message: 'The system audio diagnostic failed unexpectedly.',
    action: 'Run diagnostics again. If it persists, inspect the diagnostic logs.',
  };
}

export async function runSystemAudioDiagnostic(
  dependencies: SystemAudioDependencies = defaultDependencies(),
): Promise<SystemAudioDiagnosticResult> {
  let capabilityState: SystemAudioCapabilityState = 'unknown';

  try {
    const capability = await dependencies.getCapability();
    capabilityState = capability.supported ? 'supported' : 'unsupported';

    if (!capability.supported) {
      return {
        state: 'blocked',
        capability: capabilityState,
        capture: 'not-attempted',
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
          capability: capabilityState,
          capture: 'no-audio-track',
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
          capability: capabilityState,
          capture: 'no-signal',
          signalDetected: false,
          message: 'A system-audio track opened, but no audio samples were detected.',
          action:
            'Play audible media in another app, then run diagnostics again and confirm system audio is included in the macOS picker.',
        };
      }

      return {
        state: 'ready',
        capability: capabilityState,
        capture: 'verified',
        signalDetected: true,
        message: 'System audio opened successfully and a live audio signal was detected.',
      };
    } finally {
      stopDiagnosticStream(stream);
    }
  } catch (error) {
    return describeSystemAudioError(error, capabilityState);
  }
}
