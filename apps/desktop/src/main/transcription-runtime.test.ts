import { describe, expect, it, vi } from 'vitest';

import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionConnection,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from '@companion-ai/transcription';

import type { AudioIpcController, AudioIpcSink } from './audio-ipc.js';
import { TranscriptionIngress } from './transcription-ingress.js';
import { TranscriptionRuntime } from './transcription-runtime.js';

class FakeProvider implements TranscriptionProvider {
  readonly id: string;
  readonly writes: AudioChunk[] = [];
  readonly close = vi.fn(async () => undefined);

  constructor(id: string) {
    this.id = id;
  }

  async connect(
    _request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ): Promise<TranscriptionConnection> {
    onEvent({ type: 'ready' });
    return {
      write: async (chunk) => {
        this.writes.push(chunk);
      },
      close: this.close,
    };
  }
}

function createHarness(apiKey: string | undefined = 'main-process-secret') {
  let sink: AudioIpcSink | undefined;
  const controller: AudioIpcController = {
    setSink: (next) => {
      sink = next;
    },
    dispose: vi.fn(),
  };
  const ingress = new TranscriptionIngress(controller);
  const providers: FakeProvider[] = [];
  const emit = vi.fn();
  const runtime = new TranscriptionRuntime(ingress, emit, {
    getApiKey: () => apiKey,
    createSessionId: () => 'session-1',
    createProvider: () => {
      const provider = new FakeProvider(`fake-${providers.length}`);
      providers.push(provider);
      return provider;
    },
  });

  return { runtime, providers, emit, getSink: () => sink };
}

describe('TranscriptionRuntime', () => {
  it('opens two independent providers and activates bounded audio ingress', async () => {
    const harness = createHarness();

    await expect(harness.runtime.start({ language: 'fr' })).resolves.toEqual({
      sessionId: 'session-1',
    });
    expect(harness.providers).toHaveLength(2);
    expect(harness.getSink()).toBeDefined();
    expect(harness.emit).toHaveBeenCalledTimes(2);

    await harness.runtime.stop();

    expect(harness.getSink()).toBeUndefined();
    expect(harness.providers[0]?.close).toHaveBeenCalledOnce();
    expect(harness.providers[1]?.close).toHaveBeenCalledOnce();
  });

  it('never creates a provider when the main-process API key is missing', async () => {
    const harness = createHarness(undefined);

    await expect(harness.runtime.start()).rejects.toThrow('DEEPGRAM_API_KEY');
    expect(harness.providers).toHaveLength(0);
    expect(harness.getSink()).toBeUndefined();
  });

  it('rejects a second start while a session is active', async () => {
    const harness = createHarness();
    await harness.runtime.start();

    await expect(harness.runtime.start()).rejects.toThrow('already active or starting');

    await harness.runtime.stop();
  });
});
