import { describe, expect, it, vi } from 'vitest';

import {
  createAssemblyAIDisconnectBenchmark,
  createDeepgramDisconnectBenchmark,
  createOpenAIDisconnectBenchmark,
} from './benchmark-provider-disconnect.js';

describe('provider disconnect benchmark config wrappers', () => {
  it('wraps Deepgram without changing provider configuration or exposing auth', () => {
    const close = vi.fn();
    const createSocket = vi.fn(() => ({ close }));
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
      createSocket: () => ({ close: assemblyClose }),
      sampleRateHz: 16_000,
    });
    const openai = createOpenAIDisconnectBenchmark({
      createSocket: () => ({ close: openAIClose }),
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
      createSocket: () => ({ close: () => undefined }),
      audioFormat: { encoding: 'pcm-s16le', sampleRateHz: 16_000, channels: 1 },
    });

    expect(() => deepgram.triggerDisconnect()).toThrow('before a provider socket was created');
  });
});
