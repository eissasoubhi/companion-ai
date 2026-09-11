import { describe, expect, it, vi } from 'vitest';

import type { AudioChunk, TranscriptionProviderEvent } from '../types.js';
import {
  buildDeepgramListenUrl,
  DeepgramNova3Provider,
  type DeepgramSocket,
  type DeepgramSocketCloseEvent,
  type DeepgramSocketMessage,
} from './deepgram.js';

class FakeSocket implements DeepgramSocket {
  readonly sent: (string | Uint8Array)[] = [];
  readonly close = vi.fn();
  #openHandlers: (() => void)[] = [];
  #messageHandlers: ((event: DeepgramSocketMessage) => void)[] = [];
  #errorHandlers: ((error: unknown) => void)[] = [];
  #closeHandlers: ((event: DeepgramSocketCloseEvent) => void)[] = [];

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  onOpen(handler: () => void): void {
    this.#openHandlers.push(handler);
  }

  onMessage(handler: (event: DeepgramSocketMessage) => void): void {
    this.#messageHandlers.push(handler);
  }

  onError(handler: (error: unknown) => void): void {
    this.#errorHandlers.push(handler);
  }

  onClose(handler: (event: DeepgramSocketCloseEvent) => void): void {
    this.#closeHandlers.push(handler);
  }

  open(): void {
    for (const handler of this.#openHandlers) handler();
  }

  message(data: string): void {
    for (const handler of this.#messageHandlers) handler({ data });
  }

  error(error: unknown): void {
    for (const handler of this.#errorHandlers) handler(error);
  }

  closed(event: DeepgramSocketCloseEvent): void {
    for (const handler of this.#closeHandlers) handler(event);
  }
}

const request = {
  sessionId: 'session-1',
  source: 'remote',
  partialResults: true,
} as const;

const format = {
  encoding: 'pcm-s16le',
  sampleRateHz: 16_000,
  channels: 1,
} as const;

function chunk(sequence = 0): AudioChunk {
  return {
    sessionId: 'session-1',
    source: 'remote',
    sequence,
    capturedAtMs: 10_000,
    ...format,
    data: new Uint8Array([1, 2, 3, 4]),
  };
}

describe('DeepgramNova3Provider', () => {
  it('builds the EU Nova-3 multilingual URL with raw audio parameters and keyterms', () => {
    const url = new URL(
      buildDeepgramListenUrl(request, {
        audioFormat: format,
        keyterms: ['Symfony', 'RabbitMQ'],
      }),
    );

    expect(url.origin).toBe('wss://api.eu.deepgram.com');
    expect(url.pathname).toBe('/v1/listen');
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('language')).toBe('multi');
    expect(url.searchParams.get('encoding')).toBe('linear16');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('channels')).toBe('1');
    expect(url.searchParams.get('interim_results')).toBe('true');
    expect(url.searchParams.get('endpointing')).toBe('100');
    expect(url.searchParams.getAll('keyterm')).toEqual(['Symfony', 'RabbitMQ']);
  });

  it('maps Deepgram partial/final Results into provider-neutral events with stable ids', async () => {
    const socket = new FakeSocket();
    const events: TranscriptionProviderEvent[] = [];
    let now = 50_000;
    const provider = new DeepgramNova3Provider(
      { createSocket: () => socket, audioFormat: format },
      () => now,
    );

    const connectionPromise = provider.connect(request, (event) => events.push(event));
    socket.open();
    const connection = await connectionPromise;

    socket.message(
      JSON.stringify({
        type: 'Results',
        start: 1.25,
        duration: 0.5,
        is_final: false,
        speech_final: false,
        channel_index: [0, 1],
        channel: { alternatives: [{ transcript: 'Tell me about' }] },
      }),
    );
    socket.message(
      JSON.stringify({
        type: 'Results',
        start: 1.25,
        duration: 0.8,
        is_final: true,
        speech_final: true,
        channel_index: [0, 1],
        channel: { alternatives: [{ transcript: 'Tell me about Symfony' }] },
      }),
    );

    expect(events[0]).toEqual({ type: 'ready' });
    expect(events[1]).toMatchObject({
      type: 'transcript',
      segmentId: 'dg:0:1250',
      text: 'Tell me about',
      isFinal: false,
      startedAtMs: 51_250,
      endedAtMs: 51_750,
    });
    expect(events[2]).toMatchObject({
      type: 'transcript',
      segmentId: 'dg:0:1250',
      text: 'Tell me about Symfony',
      isFinal: true,
      startedAtMs: 51_250,
      endedAtMs: 52_050,
    });

    now = 51_000;
    await connection.write(chunk());
    expect(socket.sent[0]).toEqual(chunk().data);
  });

  it('rejects audio whose format differs from the WebSocket handshake', async () => {
    const socket = new FakeSocket();
    const provider = new DeepgramNova3Provider({
      createSocket: () => socket,
      audioFormat: format,
    });

    const connectionPromise = provider.connect(request, () => undefined);
    socket.open();
    const connection = await connectionPromise;

    await expect(
      connection.write({ ...chunk(), sampleRateHz: 48_000 }),
    ).rejects.toThrow('does not match');
    expect(socket.sent).toHaveLength(0);
  });

  it('maps authentication errors as terminal and network closes as retryable', async () => {
    const socket = new FakeSocket();
    const events: TranscriptionProviderEvent[] = [];
    const provider = new DeepgramNova3Provider({
      createSocket: () => socket,
      audioFormat: format,
    });

    const connectionPromise = provider.connect(request, (event) => events.push(event));
    socket.open();
    await connectionPromise;

    socket.message(
      JSON.stringify({
        type: 'Error',
        err_code: 'AUTH_INVALID',
        err_msg: 'Invalid credentials',
      }),
    );
    socket.closed({ code: 1013, reason: 'Try again later' });

    expect(events).toContainEqual({
      type: 'error',
      code: 'AUTH_INVALID',
      message: 'Invalid credentials',
      retryable: false,
    });
    expect(events).toContainEqual({
      type: 'error',
      code: 'websocket-close-1013',
      message: 'Try again later',
      retryable: true,
    });
  });

  it('finalizes and closes the stream explicitly', async () => {
    const socket = new FakeSocket();
    const events: TranscriptionProviderEvent[] = [];
    const provider = new DeepgramNova3Provider({
      createSocket: () => socket,
      audioFormat: format,
    });

    const connectionPromise = provider.connect(request, (event) => events.push(event));
    socket.open();
    const connection = await connectionPromise;
    await connection.close();

    expect(socket.sent).toEqual([
      JSON.stringify({ type: 'Finalize' }),
      JSON.stringify({ type: 'CloseStream' }),
    ]);
    expect(socket.close).toHaveBeenCalledWith(1000, 'client-close');
    expect(events.at(-1)).toEqual({ type: 'closed', reason: 'client-close' });
  });
});
