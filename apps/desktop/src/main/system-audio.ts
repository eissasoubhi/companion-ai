import type { Session } from 'electron';

export type SystemAudioCaptureMode = 'macos-system-picker' | 'unsupported';

export interface SystemAudioCapability {
  readonly supported: boolean;
  readonly mode: SystemAudioCaptureMode;
  readonly platform: NodeJS.Platform;
  readonly systemVersion: string;
  readonly reason?: string | undefined;
}

function parseMajorVersion(version: string): number | null {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

export function getSystemAudioCapability(): SystemAudioCapability {
  const systemVersion = process.getSystemVersion();

  if (process.platform !== 'darwin') {
    return {
      supported: false,
      mode: 'unsupported',
      platform: process.platform,
      systemVersion,
      reason: 'P0 system-audio capture currently targets macOS only.',
    };
  }

  const majorVersion = parseMajorVersion(systemVersion);
  if (majorVersion === null || majorVersion < 15) {
    return {
      supported: false,
      mode: 'unsupported',
      platform: process.platform,
      systemVersion,
      reason:
        'The first reliable capture path uses the native macOS system picker available on macOS 15 or later.',
    };
  }

  return {
    supported: true,
    mode: 'macos-system-picker',
    platform: process.platform,
    systemVersion,
  };
}

export function configureSystemAudioCapture(session: Session): void {
  const capability = getSystemAudioCapability();

  if (capability.mode !== 'macos-system-picker') {
    session.setDisplayMediaRequestHandler((_request, callback) => callback(null));
    return;
  }

  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      // On supported macOS versions Electron delegates to the native picker and
      // this fallback handler should not run. Fail closed if it unexpectedly does.
      callback(null);
    },
    { useSystemPicker: true },
  );
}
