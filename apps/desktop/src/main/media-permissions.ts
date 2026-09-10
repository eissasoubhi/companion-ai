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

export function configureMediaPermissionHandlers(session: Session): void {
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== 'media') {
      return false;
    }

    const trustedOrigin =
      isAppOrigin(requestingOrigin) || isAppOrigin(details.securityOrigin);
    const trustedContents =
      webContents === null || isAppOrigin(webContents.getURL());
    const audioOnly =
      details.mediaType === undefined ||
      details.mediaType === 'audio' ||
      details.mediaType === 'unknown';

    return trustedOrigin && trustedContents && audioOnly;
  });

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== 'media' || !isAppOrigin(webContents.getURL())) {
      callback(false);
      return;
    }

    const mediaTypes = details.mediaTypes ?? [];
    const audioOnly = mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');

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
