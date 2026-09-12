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

  interface NetworkDiagnosticResult {
    readonly state: 'ready' | 'blocked' | 'error';
    readonly host: string;
    readonly latencyMs?: number | undefined;
    readonly httpStatus?: number | undefined;
    readonly message: string;
    readonly action?: string | undefined;
  }

  interface RendererAudioChunk {
    readonly sessionId: string;
    readonly source: 'local' | 'remote';
    readonly sequence: number;
    readonly capturedAtMs: number;
    readonly sampleRateHz: number;
    readonly channels: 1;
    readonly encoding: 'pcm-s16le';
    readonly data: Uint8Array;
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
      readonly network: {
        runDiagnostic(): Promise<NetworkDiagnosticResult>;
      };
      readonly audio: {
        writeChunk(chunk: RendererAudioChunk): Promise<void>;
      };
    };
  }
}
