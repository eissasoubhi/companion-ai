export interface AudioSignalOptions {
  readonly durationMs?: number;
  readonly threshold?: number;
}

async function cleanupAudioSignalResources(
  source: MediaStreamAudioSourceNode,
  context: AudioContext,
): Promise<void> {
  let cleanupError: unknown;

  try {
    source.disconnect();
  } catch (error) {
    cleanupError = error;
  }

  try {
    await context.close();
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError !== undefined) throw cleanupError;
}

export async function detectAudioSignal(
  stream: MediaStream,
  createAudioContext: () => AudioContext,
  options: AudioSignalOptions = {},
): Promise<boolean> {
  const durationMs = options.durationMs ?? 700;
  const threshold = options.threshold ?? 2;
  const context = createAudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;

  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const deadline = performance.now() + durationMs;
  let signalDetected = false;

  try {
    while (performance.now() < deadline && !signalDetected) {
      analyser.getByteTimeDomainData(samples);
      signalDetected = samples.some((sample) => Math.abs(sample - 128) > threshold);

      if (!signalDetected) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
  } finally {
    await cleanupAudioSignalResources(source, context);
  }

  return signalDetected;
}
