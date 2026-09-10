export type MicrophoneDiagnosticState =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'blocked'
  | 'error';

export interface MicrophoneDiagnosticResult {
  readonly state: Exclude<MicrophoneDiagnosticState, 'idle' | 'checking'>;
  readonly deviceLabel?: string;
  readonly signalDetected?: boolean;
  readonly message: string;
  readonly action?: string;
}

interface MicrophoneDependencies {
  readonly getPermissionStatus: () => Promise<MediaAccessStatus>;
  readonly requestPermission: () => Promise<MediaAccessStatus>;
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly enumerateDevices: () => Promise<MediaDeviceInfo[]>;
  readonly createAudioContext: () => AudioContext;
}

function permissionFailure(status: MediaAccessStatus): MicrophoneDiagnosticResult | null {
  if (status === 'denied') {
    return {
      state: 'blocked',
      message: 'Microphone access is denied by the operating system.',
      action: 'Allow microphone access in system privacy settings, then restart Companion AI.',
    };
  }

  if (status === 'restricted') {
    return {
      state: 'blocked',
      message: 'Microphone access is restricted on this device.',
      action: 'Check device or organization privacy restrictions.',
    };
  }

  return null;
}

export function describeMicrophoneError(error: unknown): MicrophoneDiagnosticResult {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return {
          state: 'blocked',
          message: 'Companion AI could not access the microphone.',
          action: 'Allow microphone access in system privacy settings and run diagnostics again.',
        };
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return {
          state: 'blocked',
          message: 'No microphone was found.',
          action: 'Connect or enable a microphone, then run diagnostics again.',
        };
      case 'NotReadableError':
      case 'TrackStartError':
        return {
          state: 'error',
          message: 'The microphone is present but could not be opened.',
          action: 'Close apps using the device exclusively or choose another microphone.',
        };
    }
  }

  return {
    state: 'error',
    message: 'The microphone diagnostic failed unexpectedly.',
    action: 'Run diagnostics again. If it persists, inspect the diagnostic logs.',
  };
}

async function detectSignal(
  stream: MediaStream,
  createAudioContext: () => AudioContext,
): Promise<boolean> {
  const context = createAudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;

  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const deadline = performance.now() + 700;
  let signalDetected = false;

  try {
    while (performance.now() < deadline && !signalDetected) {
      analyser.getByteTimeDomainData(samples);
      signalDetected = samples.some((sample) => Math.abs(sample - 128) > 2);

      if (!signalDetected) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
  } finally {
    source.disconnect();
    await context.close();
  }

  return signalDetected;
}

function defaultDependencies(): MicrophoneDependencies {
  return {
    getPermissionStatus: () => window.companion.microphone.getPermissionStatus(),
    requestPermission: () => window.companion.microphone.requestPermission(),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    createAudioContext: () => new AudioContext(),
  };
}

export async function runMicrophoneDiagnostic(
  dependencies: MicrophoneDependencies = defaultDependencies(),
): Promise<MicrophoneDiagnosticResult> {
  try {
    let permission = await dependencies.getPermissionStatus();
    const initialFailure = permissionFailure(permission);
    if (initialFailure) {
      return initialFailure;
    }

    if (permission === 'not-determined') {
      permission = await dependencies.requestPermission();
      const requestedFailure = permissionFailure(permission);
      if (requestedFailure) {
        return requestedFailure;
      }
    }

    const stream = await dependencies.getUserMedia({
      audio: true,
      video: false,
    });

    try {
      const track = stream.getAudioTracks()[0];
      if (!track) {
        return {
          state: 'blocked',
          message: 'The audio stream opened without a microphone track.',
          action: 'Choose another input device and run diagnostics again.',
        };
      }

      const devices = await dependencies.enumerateDevices();
      const settings = track.getSettings();
      const device = devices.find(
        (candidate) =>
          candidate.kind === 'audioinput' && candidate.deviceId === settings.deviceId,
      );
      const signalDetected = await detectSignal(stream, dependencies.createAudioContext);
      const deviceLabel = device?.label || track.label || 'Default microphone';

      return {
        state: 'ready',
        deviceLabel,
        signalDetected,
        message: signalDetected
          ? 'Microphone opened successfully and an audio signal was detected.'
          : 'Microphone opened successfully. No signal was detected during the short sample.',
        action: signalDetected
          ? undefined
          : 'Speak while running diagnostics again if you want to confirm the input level.',
      };
    } finally {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  } catch (error) {
    return describeMicrophoneError(error);
  }
}
