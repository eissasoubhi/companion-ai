import { describe, expect, it, vi } from 'vitest';

import { TranscriptionSession } from './session.js';
import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionConnection,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from './types.js';

class FakeProvider implements TranscriptionProvider {
  readonly id: string;
  readonly requests: TranscriptionConnectRequest[] = [];
  readonly writes: AudioChunk[] = [];
  readonly close = vi.fn(async () => undefined);

  constructor(id: string) {
    this.id = id;
  }

  async connect(
    request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ): Promise<TranscriptionConnection> {
    this.requests.push(request);
    onEvent({ type: 'ready' });
    return {
      write: async (chunk) => {
        this.writes.push(chunk);
      },
      close: this.close,
    };
  }
}

class FailingProvider implements TranscriptionProvider {
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  async connect(
    _request: TranscriptionConnectRequest,
    _onEvent: TranscriptionProviderEventHandler,
  ): Promise<TranscriptionConnection> {
    throw new Error('provider connect failed');
  }
}

function chunk(
  source: AudioChunk['source'],
  sequence: number,
  sessionId = 'meeting-1',
): AudioChunk {
  return {
    sessionId,
    source,
    sequence,
    capturedAtMs: 1_000 + sequence * 20,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: 'pcm-s16le',
    data: new Uint8Array([1, 2, 3, 4]),
  };
}

describe('TranscriptionSession', () => {
  it('opens independent local and remote channels and never mixes their audio', async () => {
    const local = new FakeProvider('local-provider');
    const remote = new FakeProvider('remote-provider');
    const events: string[] = [];
    const session = await TranscriptionSession.open({
      sessionId: 'meeting-1',
      localProvider: local,
      remoteProvider: remote,
      emit: (event) => {
        const source = event.type === 'transcript' ? event.segment.source : event.source;
        events.push(`${event.type}:${source}`);
      },
    });

    await Promise.all([
      session.writeAudio(chunk('local', 0)),
      session.writeAudio(chunk('remote', 0)),
    ]);
    await session.writeAudio(chunk('local', 1));
    await session.writeAudio(chunk('remote', 1));

    expect(local.requests).toEqual([
      expect.objectContaining({ sessionId: 'meeting-1', source: 'local', partialResults: true }),
    ]);
    expect(remote.requests).toEqual([
      expect.objectContaining({ sessionId: 'meeting-1', source: 'remote', partialResults: true }),
    ]);
    expect(local.writes.map((item) => item.source)).toEqual(['local', 'local']);
    expect(remote.writes.map((item) => item.source)).toEqual(['remote', 'remote']);
    expect(events).toContain('provider-ready:local');
    expect(events).toContain('provider-ready:remote');
  });

  it('rejects chunks from another session before they reach either provider', async () => {
    const local = new FakeProvider('local-provider');
    const remote = new FakeProvider('remote-provider');
    const session = await TranscriptionSession.open({
      sessionId: 'meeting-1',
      localProvider: local,
      remoteProvider: remote,
      emit: () => undefined,
    });

    await expect(session.writeAudio(chunk('local', 0, 'meeting-2'))).rejects.toThrow(
      'does not belong',
    );
    expect(local.writes).toHaveLength(0);
    expect(remote.writes).toHaveLength(0);
  });

  it('rejects unknown audio instead of routing it into the remote channel', async () => {
    const local = new FakeProvider('local-provider');
    const remote = new FakeProvider('remote-provider');
    const session = await TranscriptionSession.open({
      sessionId: 'meeting-1',
      localProvider: local,
      remoteProvider: remote,
      emit: () => undefined,
    });

    await expect(session.writeAudio(chunk('unknown', 0))).rejects.toThrow(
      'only accepts local or remote',
    );
    expect(local.writes).toHaveLength(0);
    expect(remote.writes).toHaveLength(0);
  });

  it('closes the channel that opened when the other provider fails to connect', async () => {
    const local = new FakeProvider('local-provider');
    const remote = new FailingProvider('remote-provider');

    await expect(
      TranscriptionSession.open({
        sessionId: 'meeting-1',
        localProvider: local,
        remoteProvider: remote,
        emit: () => undefined,
      }),
    ).rejects.toThrow('provider connect failed');

    expect(local.close).toHaveBeenCalledTimes(1);
  });

  it('closes both providers and rejects later writes', async () => {
    const local = new FakeProvider('local-provider');
    const remote = new FakeProvider('remote-provider');
    const session = await TranscriptionSession.open({
      sessionId: 'meeting-1',
      localProvider: local,
      remoteProvider: remote,
      emit: () => undefined,
    });

    await session.close();

    expect(local.close).toHaveBeenCalledTimes(1);
    expect(remote.close).toHaveBeenCalledTimes(1);
    await expect(session.writeAudio(chunk('local', 0))).rejects.toThrow('closed');
  });
});
