export {};

declare global {
  type MediaAccessStatus =
    | 'not-determined'
    | 'granted'
    | 'denied'
    | 'restricted'
    | 'unknown'
    | 'unsupported';

  interface SystemAudioCapability {
    readonly supported: boolean;
    readonly mode: 'macos-system-picker' | 'unsupported';
    readonly platform: string;
    readonly systemVersion: string;
    readonly reason?: string | undefined;
  }

  interface Window {
    companion: {
      readonly platform: string;
      readonly microphone: {
        getPermissionStatus(): Promise<MediaAccessStatus>;
        requestPermission(): Promise<MediaAccessStatus>;
      };
      readonly systemAudio: {
        getCapability(): Promise<SystemAudioCapability>;
      };
    };
  }
}
