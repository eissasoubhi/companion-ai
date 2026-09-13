import { describe, expect, it, vi } from 'vitest';

import {
  createAssemblyAIDisconnectBenchmark,
  createDeepgramDisconnectBenchmark,
  createOpenAIDisconnectBenchmark,
} from './benchmark-provider-disconnect.js';
import type { AssemblyAISocket } from './providers/assemblyai.js';
import type { DeepgramSocket } from './providers/deepgram.js';
import type { OpenAIRealtimeSocket } from './providers/openai.js';

function deepgramSocket(close: DeepgramSocket['close']): DeepgramSocket {
  return {
    close,
    send: () => undefined,
    onOpen: () => undefined,
    onMessage: () => undefined,
    onError: () => undefined,
    onClose: () => undefined,
  };
}

function assemblySocket(close: AssemblyAISocket['close']): AssemblyAISocket {
  return {
    close,
    send: () => undefined,
    onOpen: () => undefined,
    onMessage: () => undefined,
    onError: () => undefined,
    onClose: () => undefined,
  };
}

function openAISocket(close: OpenAIRealtimeSocket['close']): OpenAIRealtimeSocket {
  return {
    close,
    send: () => undefined,
    onOpen: () => undefined,
    onMessage: () => undefined,
    onError: () => undefined,
    onClose: () => undefined,
  };
}

describe('provider disconnect benchmark config wrappers', () => {
  it('wraps Deepgram without changing provider configuration or exposing auth', () => {
    const close = vi.fn<DeepgramSocket['close']>();
    const createSocket = vi.fn(() => deepgramSocket(close));
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
    const assemblyClose = vi.fn<AssemblyAISocket['close']>();
    const openAIClose = vi.fn<OpenAIRealtimeSocket['close']>();
    const assembly = createAssemblyAIDisconnectBenchmark({
      createSocket: () => assemblySocket(assemblyClose),
      sampleRateHz: 16_000,
    });
    const openai = createOpenAIDisconnectBenchmark({
      createSocket: () => openAISocket(openAIClose),
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
      createSocket: () => deepgramSocket(vi.fn<DeepgramSocket['close']>()),
      audioFormat: { encoding: 'pcm-s16le', sampleRateHz: 16_000, channels: 1 },
    });

    expect(() => deepgram.triggerDisconnect()).toThrow('before a provider socket was created');
  });
});
