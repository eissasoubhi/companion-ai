import {
  BoundedQueue,
  FixedFramePcm16Encoder,
  downmixToMono,
} from '@companion-ai/audio';

export type LiveAudioSource = 'local' | 'remote';

export interface LiveAudioStreamOptions {
  readonly stream: MediaStream;
  readonly source: LiveAudioSource;
  readonly sessionId: string;
  readonly targetSampleRateHz?: number;
  readonly frameDurationMs?: number;
  readonly queueCapacity?: number;
  readonly onDegraded?: (reason: 'track-ended' | 'write-failed', error?: unknown) => void;
}

export interface LiveAudioStreamHandle {
  readonly source: LiveAudioSource;
  readonly droppedFrames: () => number;
  stop(): Promise<void>;
}

interface LiveAudioDependencies {
  readonly createAudioContext: (options: AudioContextOptions) => AudioContext;
  readonly writeChunk: (chunk: RendererAudioChunk) => Promise<void>;
  readonly now: () => number;
}

const DEFAULT_TARGET_SAMPLE_RATE_HZ = 16_000;
const DEFAULT_FRAME_DURATION_MS = 20;
const DEFAULT_QUEUE_CAPACITY = 32;

function defaultDependencies(): LiveAudioDependencies {
  return {
    createAudioContext: (options) => new AudioContext(options),
    writeChunk: (chunk) => window.companion.audio.writeChunk(chunk),
    now: () => performance.timeOrigin + performance.now(),
  };
}

function resampleMono(
  samples: Float32Array,
  inputRateHz: number,
  outputRateHz: number,
): Float32Array {
  if (inputRateHz === outputRateHz || samples.length === 0) {
    return new Float32Array(samples);
  }

  const outputLength = Math.max(1, Math.round((samples.length * outputRateHz) / inputRateHz));
  const output = new Float32Array(outputLength);
  const ratio = inputRateHz / outputRateHz;

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    const leftValue = samples[left] ?? 0;
    const rightValue = samples[right] ?? leftValue;
    output[index] = leftValue + (rightValue - leftValue) * fraction;
  }

  return output;
}

export async function startLiveAudioStream(
  options: LiveAudioStreamOptions,
  dependencies: LiveAudioDependencies = defaultDependencies(),
): Promise<LiveAudioStreamHandle> {
  const track = options.stream.getAudioTracks().find((candidate) => candidate.readyState === 'live');
  if (!track) throw new Error(`No live ${options.source} audio track is available.`);
  if (!options.sessionId.trim()) throw new Error('sessionId is required.');
  const liveTrack = track;

  const targetSampleRateHz = options.targetSampleRateHz ?? DEFAULT_TARGET_SAMPLE_RATE_HZ;
  const frameDurationMs = options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
  const queue = new BoundedQueue<RendererAudioChunk>(
    options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY,
  );
  const encoder = new FixedFramePcm16Encoder({
    sampleRateHz: targetSampleRateHz,
    frameDurationMs,
  });
  const context = dependencies.createAudioContext({
    latencyHint: 'interactive',
    sampleRate: targetSampleRateHz,
  });
  const sourceNode = context.createMediaStreamSource(options.stream);
  const processor = context.createScriptProcessor(512, 2, 1);

  let stopped = false;
  let draining = false;
  let droppedFrames = 0;

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    liveTrack.removeEventListener('ended', onTrackEnded);
    processor.onaudioprocess = null;
    queue.clear();
    encoder.reset();
    sourceNode.disconnect();
    processor.disconnect();
    for (const streamTrack of options.stream.getTracks()) streamTrack.stop();
    if (context.state !== 'closed') await context.close();
  }

  async function drain(): Promise<void> {
    if (draining || stopped) return;
    draining = true;
    try {
      while (!stopped) {
        const chunk = queue.shift();
        if (!chunk) break;
        try {
          await dependencies.writeChunk(chunk);
        } catch (error) {
          options.onDegraded?.('write-failed', error);
          await stop();
          break;
        }
      }
    } finally {
      draining = false;
    }
  }

  function onTrackEnded(): void {
    if (stopped) return;
    options.onDegraded?.('track-ended');
    void stop();
  }

  liveTrack.addEventListener('ended', onTrackEnded, { once: true });

  processor.onaudioprocess = (event) => {
    if (stopped) return;

    const channels: Float32Array[] = [];
    for (let channel = 0; channel < event.inputBuffer.numberOfChannels; channel += 1) {
      channels.push(new Float32Array(event.inputBuffer.getChannelData(channel)));
    }
    if (channels.length === 0) return;

    const mono = downmixToMono(channels);
    const normalized = resampleMono(mono, context.sampleRate, targetSampleRateHz);
    const frames = encoder.push(normalized, dependencies.now());

    for (const frame of frames) {
      const result = queue.push({
        sessionId: options.sessionId,
        source: options.source,
        sequence: frame.sequence,
        startedAtMs: frame.startedAtMs,
        sampleRateHz: frame.sampleRateHz,
        channels: frame.channels,
        encoding: 'pcm-s16le',
        data: frame.data,
      });
      if (result.dropped) droppedFrames += 1;
    }

    void drain();
  };

  try {
    sourceNode.connect(processor);
    processor.connect(context.destination);
    if (context.state === 'suspended') await context.resume();
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    source: options.source,
    droppedFrames: () => droppedFrames,
    stop,
  };
}
