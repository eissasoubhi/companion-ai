import { describe, expect, it, vi } from 'vitest';

import {
  AssemblyAIUniversal35Provider,
  buildAssemblyAIStreamingUrl,
  type AssemblyAISocket,
  type AssemblyAISocketCloseEvent,
  type AssemblyAISocketMessage,
} from './assemblyai.js';
import type { TranscriptionProviderEvent } from '../types.js';

class FakeSocket implements AssemblyAISocket {
  readonly sent: Array<string | Uint8Array> = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];
  #open?: () => void;
  #message?: (event: AssemblyAISocketMessage) => void;
  #error?: (error: unknown) => void;
  #close?: (event: AssemblyAISocketCloseEvent) => void;

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) });
  }

  onOpen(handler: () => void): void {
    this.#open = handler;
  }

  onMessage(handler: (event: AssemblyAISocketMessage) => void): void {
    this.#message = handler;
  }

  onError(handler: (error: unknown) => void): void {
    this.#error = handler;
  }

  onClose(handler: (event: AssemblyAISocketCloseEvent) => void): void {
    this.#close = handler;
  }

  emitOpen(): void {
    this.#open?.();
  }

  emitMessage(value: unknown): void {
    this.#message?.({ data: JSON.stringify(value) });
  }

  emitError(error: unknown): void {
    this.#error?.(error);
  }

  emitClose(event: AssemblyAISocketCloseEvent = {}): void {
    this.#close?.(event);
  }
}

const request = {
  sessionId: 'session-1',
  source: 'remote',
  partialResults: true,
} as const;

function audio(data = new Uint8Array([1, 2, 3])) {
  return {
    sessionId: 'session-1',
    source: 'remote',
    sequence: 0,
    capturedAtMs: 10,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: 'pcm-s16le',
    data,
  } as const;
}

describe('AssemblyAIUniversal35Provider', () => {
  it('builds the current v3 streaming URL without putting credentials in it', () => {
    const url = new URL(buildAssemblyAIStreamingUrl(request, {
      createSocket: () => new FakeSocket(),
      sampleRateHz: 16_000,
    }));

    expect(url.origin).toBe('wss://streaming.assemblyai.com');
    expect(url.pathname).toBe('/v3/ws');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('speech_model')).toBe('universal-3-5-pro');
    expect(url.searchParams.get('continuous_partials')).toBe('true');
    expect(url.search).not.toContain('key');
    expect(url.search).not.toContain('token');
  });

  it('streams binary PCM and maps partial/final Turn events', async () => {
    const socket = new FakeSocket();
    const events: TranscriptionProviderEvent[] = [];
    const provider = new AssemblyAIUniversal35Provider(
      { createSocket: () => socket, sampleRateHz: 16_000 },
      () => 250,
    );

    const connecting = provider.connect(request, (event) => events.push(event));
    socket.emitOpen();
    const connection = await connecting;

    await connection.write(audio());
    socket.emitMessage({ type: 'Turn', transcript: '  Explain Symfony ', end_of_turn: false, turn_order: 7 });
    socket.emitMessage({ type: 'Turn', transcript: 'Explain Symfony', end_of_turn: true, turn_order: 7 });

    expect(socket.sent[0]).toEqual(new Uint8Array([1, 2, 3]));
    expect(events).toEqual([
      { type: 'ready' },
      {
        type: 'transcript',
        segmentId: 'session-1:remote:turn-7',
        text: 'Explain Symfony',
        isFinal: false,
        startedAtMs: 250,
      },
      {
        type: 'transcript',
        segmentId: 'session-1:remote:turn-7',
        text: 'Explain Symfony',
        isFinal: true,
        startedAtMs: 250,
        endedAtMs: 250,
      },
    ]);
  });

  it('rejects incompatible audio before sending it', async () => {
    const socket = new FakeSocket();
    const provider = new AssemblyAIUniversal35Provider({
      createSocket: () => socket,
      sampleRateHz: 16_000,
    });

    const connecting = provider.connect(request, vi.fn());
    socket.emitOpen();
    const connection = await connecting;

    await expect(connection.write({ ...audio(), channels: 2 })).rejects.toThrow('mono pcm-s16le');
    await expect(connection.write({ ...audio(), sampleRateHz: 48_000 })).rejects.toThrow('expected 16000Hz');
    expect(socket.sent).toHaveLength(0);
  });

  it('sends Terminate on clean close and does not report it as an unexpected failure', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const events: TranscriptionProviderEvent[] = [];
    const provider = new AssemblyAIUniversal35Provider({
      createSocket: () => socket,
      sampleRateHz: 16_000,
      closeTimeoutMs: 100,
    });

    const connecting = provider.connect(request, (event) => events.push(event));
    socket.emitOpen();
    const connection = await connecting;
    const closing = connection.close();

    expect(socket.sent).toContain(JSON.stringify({ type: 'Terminate' }));
    socket.emitClose({ code: 1000, reason: 'terminated' });
    await closing;

    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'closed', reason: 'terminated' });
    vi.useRealTimers();
  });

  it('marks transient unexpected socket closes retryable', async () => {
    const socket = new FakeSocket();
    const events: TranscriptionProviderEvent[] = [];
    const provider = new AssemblyAIUniversal35Provider({
      createSocket: () => socket,
      sampleRateHz: 16_000,
    });

    const connecting = provider.connect(request, (event) => events.push(event));
    socket.emitOpen();
    await connecting;
    socket.emitClose({ code: 1013, reason: 'try later' });

    expect(events).toContainEqual({
      type: 'error',
      code: 'socket_closed_1013',
      message: 'try later',
      retryable: true,
    });
  });

  it('rejects insecure endpoints at construction time', () => {
    expect(() => new AssemblyAIUniversal35Provider({
      createSocket: () => new FakeSocket(),
      sampleRateHz: 16_000,
      endpoint: 'ws://localhost:1234',
    })).toThrow('must use WSS');
  });
});
