import { describe, expect, it } from 'vitest';

import { BoundedQueue } from './bounded-queue.js';
import { FixedFramePcm16Encoder } from './frame-encoder.js';
import { downmixToMono, float32ToPcm16Bytes } from './pcm.js';

describe('PCM normalization', () => {
  it('downmixes channels by averaging each sample', () => {
    const mono = downmixToMono([
      new Float32Array([1, 0.5, -1]),
      new Float32Array([-1, 0.5, 1]),
    ]);

    expect(Array.from(mono)).toEqual([0, 0.5, 0]);
  });

  it('clamps and encodes Float32 samples as little-endian signed PCM16', () => {
    const bytes = float32ToPcm16Bytes(
      new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]),
    );
    const view = new DataView(bytes.buffer);
    const decoded = Array.from(
      { length: bytes.length / 2 },
      (_, index) => view.getInt16(index * 2, true),
    );

    expect(decoded).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767]);
  });
});

describe('FixedFramePcm16Encoder', () => {
  it('combines small worklet blocks into stable fixed-duration frames', () => {
    const encoder = new FixedFramePcm16Encoder({
      sampleRateHz: 1_000,
      frameDurationMs: 10,
    });

    expect(encoder.push(new Float32Array(4).fill(0.25), 2_000)).toHaveLength(0);
    const frames = encoder.push(new Float32Array(16).fill(0.5), 2_004);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      sequence: 0,
      startedAtMs: 2_000,
      sampleRateHz: 1_000,
      channels: 1,
    });
    expect(frames[1]).toMatchObject({
      sequence: 1,
      startedAtMs: 2_010,
    });
    expect(frames[0]?.data).toHaveLength(20);
    expect(encoder.pendingSamples).toBe(0);
  });

  it('keeps remainder timestamps continuous across pushes even when capture timestamps jump', () => {
    const encoder = new FixedFramePcm16Encoder({
      sampleRateHz: 1_000,
      frameDurationMs: 10,
    });

    const first = encoder.push(new Float32Array(15), 5_000);
    expect(first[0]?.startedAtMs).toBe(5_000);
    expect(encoder.pendingSamples).toBe(5);

    const second = encoder.push(new Float32Array(5), 9_999);
    expect(second[0]?.startedAtMs).toBe(5_010);
    expect(second[0]?.sequence).toBe(1);
  });

  it('reset clears buffered samples and restarts sequence/timestamp state', () => {
    const encoder = new FixedFramePcm16Encoder({
      sampleRateHz: 1_000,
      frameDurationMs: 10,
    });

    encoder.push(new Float32Array(15), 1_000);
    encoder.reset();

    expect(encoder.pendingSamples).toBe(0);
    const frames = encoder.push(new Float32Array(10), 2_000);
    expect(frames[0]).toMatchObject({ sequence: 0, startedAtMs: 2_000 });
  });
});

describe('BoundedQueue', () => {
  it('drops the oldest item instead of allowing latency and memory to grow unbounded', () => {
    const queue = new BoundedQueue<number>(2);

    queue.push(1);
    queue.push(2);
    const result = queue.push(3);

    expect(result.dropped).toBe(1);
    expect(queue.droppedCount).toBe(1);
    expect(queue.size).toBe(2);
    expect(queue.shift()).toBe(2);
    expect(queue.shift()).toBe(3);
  });
});
