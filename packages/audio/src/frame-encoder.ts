import { float32ToPcm16Bytes } from './pcm.js';

export interface EncodedPcm16Frame {
  readonly sequence: number;
  readonly startedAtMs: number;
  readonly sampleRateHz: number;
  readonly channels: 1;
  readonly data: Uint8Array;
}

export interface FixedFrameEncoderOptions {
  readonly sampleRateHz: number;
  readonly frameDurationMs: number;
}

export class FixedFramePcm16Encoder {
  readonly #sampleRateHz: number;
  readonly #samplesPerFrame: number;
  #pending = new Float32Array(0);
  #pendingStartedAtMs: number | undefined;
  #nextSequence = 0;

  constructor(options: FixedFrameEncoderOptions) {
    if (!Number.isFinite(options.sampleRateHz) || options.sampleRateHz <= 0) {
      throw new RangeError('sampleRateHz must be a positive number.');
    }
    if (!Number.isFinite(options.frameDurationMs) || options.frameDurationMs <= 0) {
      throw new RangeError('frameDurationMs must be a positive number.');
    }

    const samplesPerFrame = Math.round(
      (options.sampleRateHz * options.frameDurationMs) / 1_000,
    );
    if (samplesPerFrame <= 0) {
      throw new RangeError('frameDurationMs is too small for the configured sample rate.');
    }

    this.#sampleRateHz = options.sampleRateHz;
    this.#samplesPerFrame = samplesPerFrame;
  }

  get pendingSamples(): number {
    return this.#pending.length;
  }

  push(samples: Float32Array, startedAtMs: number): EncodedPcm16Frame[] {
    if (!Number.isFinite(startedAtMs)) {
      throw new RangeError('startedAtMs must be finite.');
    }
    if (samples.length === 0) return [];

    if (this.#pending.length === 0) {
      this.#pendingStartedAtMs = startedAtMs;
    }

    const combined = new Float32Array(this.#pending.length + samples.length);
    combined.set(this.#pending, 0);
    combined.set(samples, this.#pending.length);
    this.#pending = combined;

    const frames: EncodedPcm16Frame[] = [];
    while (this.#pending.length >= this.#samplesPerFrame) {
      const frameSamples = this.#pending.slice(0, this.#samplesPerFrame);
      const frameStartedAtMs = this.#pendingStartedAtMs ?? startedAtMs;
      frames.push({
        sequence: this.#nextSequence,
        startedAtMs: frameStartedAtMs,
        sampleRateHz: this.#sampleRateHz,
        channels: 1,
        data: float32ToPcm16Bytes(frameSamples),
      });
      this.#nextSequence += 1;

      this.#pending = this.#pending.slice(this.#samplesPerFrame);
      this.#pendingStartedAtMs =
        frameStartedAtMs + (this.#samplesPerFrame / this.#sampleRateHz) * 1_000;
    }

    if (this.#pending.length === 0) {
      this.#pendingStartedAtMs = undefined;
    }

    return frames;
  }

  reset(): void {
    this.#pending = new Float32Array(0);
    this.#pendingStartedAtMs = undefined;
    this.#nextSequence = 0;
  }
}
