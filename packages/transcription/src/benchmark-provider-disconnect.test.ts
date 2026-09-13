import { describe, expect, it, vi } from 'vitest';

import {
  createAssemblyAIDisconnectBenchmark,
  createDeepgramDisconnectBenchmark,
  createOpenAIDisconnectBenchmark,
} from './benchmark-provider-disconnect.js';

function benchmarkSocket(close: ReturnType<typeof vi.fn>) {
  return {
    close,
    send: vi.fn(),
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('provider disconnect benchmark config wrappers', () => {
  it('wraps Deepgram without changing provider configuration or exposing auth', () => {
    const close = vi.fn();
    const createSocket = vi.fn(() => benchmarkSocket(close));
    const benchmark = createDeepgramDisconnectBenchmark({
      createSocket,
      audioFormat: { encoding: 'pcm-s16le', sampleRateHz: 16_000, channels: 1 },
      model: 'nova-3',
    });

    benchmark.config.createSocket('wss://deepgram.example');
    benchmark.triggerDisconnect();

    expect(close).toHaveBeenCalledWith(1012, 'benchmark-controlled-disconnect');
    expect(benchmark.config.audioFormat.sampleRateHz).toBe(16_000);
    expect(benchmark.config.model).toBe('nova-3');
  });

  it('wraps AssemblyAI and OpenAI with independent controlled sockets', () => {
    const assemblyClose = vi.fn();
    const openAIClose = vi.fn();
    const assembly = createAssemblyAIDisconnectBenchmark({
      createSocket: () => benchmarkSocket(assemblyClose),
      sampleRateHz: 16_000,
    });
    const openai = createOpenAIDisconnectBenchmark({
      createSocket: () => benchmarkSocket(openAIClose),
      sampleRateHz: 24_000,
    });

    assembly.config.createSocket('wss://assembly.example');
    openai.config.createSocket('wss://openai.example');
    assembly.triggerDisconnect();

    expect(assemblyClose).toHaveBeenCalledTimes(1);
    expect(openAIClose).not.toHaveBeenCalled();

    openai.triggerDisconnect();
    expect(openAIClose).toHaveBeenCalledTimes(1);
  });

  it('fails closed before each provider has created an active socket', () => {
    const deepgram = createDeepgramDisconnectBenchmark({
      createSocket: () => benchmarkSocket(vi.fn()),
      audioFormat: { encoding: 'pcm-s16le', sampleRateHz: 16_000, channels: 1 },
    });

    expect(() => deepgram.triggerDisconnect()).toThrow('before a provider socket was created');
  });
});
