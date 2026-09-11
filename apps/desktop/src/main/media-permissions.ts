import { systemPreferences, type Session } from 'electron';

export type MediaAccessStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'
  | 'unsupported';

const APP_ORIGIN = 'file://';

function isAppOrigin(origin: string | undefined): boolean {
  return origin === APP_ORIGIN || origin?.startsWith('file:///') === true;
}

function isTrustedRequest(
  webContents: Electron.WebContents | null,
  requestingOrigin: string | undefined,
  securityOrigin?: string | undefined,
): boolean {
  const trustedOrigin =
    isAppOrigin(requestingOrigin) || isAppOrigin(securityOrigin);
  const trustedContents =
    webContents === null || isAppOrigin(webContents.getURL());

  return trustedOrigin && trustedContents;
}

export function configureMediaPermissionHandlers(session: Session): void {
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (
      permission === 'display-capture' &&
      isTrustedRequest(webContents, requestingOrigin, details.securityOrigin)
    ) {
      return true;
    }

    if (permission !== 'media') {
      return false;
    }

    const trustedRequest = isTrustedRequest(
      webContents,
      requestingOrigin,
      details.securityOrigin,
    );
    const audioOnly =
      details.mediaType === undefined ||
      details.mediaType === 'audio' ||
      details.mediaType === 'unknown';

    return trustedRequest && audioOnly;
  });

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!isAppOrigin(webContents.getURL())) {
      callback(false);
      return;
    }

    if (permission === 'display-capture') {
      callback(true);
      return;
    }

    if (permission !== 'media' || !('mediaTypes' in details)) {
      callback(false);
      return;
    }

    const mediaTypes = details.mediaTypes ?? [];
    const audioOnly =
      mediaTypes.length > 0 && mediaTypes.every((mediaType) => mediaType === 'audio');

    callback(audioOnly);
  });
}

export function getMicrophonePermissionStatus(): MediaAccessStatus {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return 'unsupported';
  }

  return systemPreferences.getMediaAccessStatus('microphone');
}

export async function requestMicrophonePermission(): Promise<MediaAccessStatus> {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone');
    return getMicrophonePermissionStatus();
  }

  return getMicrophonePermissionStatus();
}
