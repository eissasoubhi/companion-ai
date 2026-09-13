import { describe, expect, it, vi } from 'vitest';

import {
  createControlledDisconnectSocketFactory,
  type ControlledDisconnectOptions,
} from './benchmark-controlled-disconnect.js';

describe('createControlledDisconnectSocketFactory', () => {
  it('closes the active socket with a retryable benchmark close and reconnects through a fresh socket', () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const createSocket = vi
      .fn<(url: string) => { close(code?: number, reason?: string): void }>()
      .mockReturnValueOnce({ close: firstClose })
      .mockReturnValueOnce({ close: secondClose });

    const harness = createControlledDisconnectSocketFactory(createSocket);

    expect(harness.createSocket('wss://provider.example/first')).toBeDefined();
    harness.triggerDisconnect();
    expect(firstClose).toHaveBeenCalledWith(1012, 'benchmark-controlled-disconnect');

    expect(harness.createSocket('wss://provider.example/reconnected')).toBeDefined();
    harness.triggerDisconnect();
    expect(secondClose).toHaveBeenCalledWith(1012, 'benchmark-controlled-disconnect');
    expect(createSocket).toHaveBeenCalledTimes(2);
  });

  it('fails closed when no provider socket is active or the same socket is disconnected twice', () => {
    const close = vi.fn();
    const harness = createControlledDisconnectSocketFactory(() => ({ close }));

    expect(() => harness.triggerDisconnect()).toThrow('before a provider socket was created');

    harness.createSocket();
    harness.triggerDisconnect();
    expect(() => harness.triggerDisconnect()).toThrow('before a provider socket was created');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('supports an explicit adapter-retryable close code and canonical reason', () => {
    const close = vi.fn();
    const harness = createControlledDisconnectSocketFactory(() => ({ close }), {
      closeCode: 1013,
      reason: 'benchmark-overload',
    });

    harness.createSocket();
    harness.triggerDisconnect();
    expect(close).toHaveBeenCalledWith(1013, 'benchmark-overload');
  });

  it('rejects runtime-invalid or non-canonical disconnect configuration', () => {
    const createSocket = () => ({ close: () => undefined });
    const invalidCloseCode = { closeCode: 1000 } as unknown as ControlledDisconnectOptions;

    expect(() => createControlledDisconnectSocketFactory(createSocket, invalidCloseCode)).toThrow(
      'retryable by every STT adapter',
    );
    expect(() =>
      createControlledDisconnectSocketFactory(createSocket, { reason: ' benchmark' }),
    ).toThrow('canonical');
    expect(() =>
      createControlledDisconnectSocketFactory(createSocket, { reason: '' }),
    ).toThrow('must not be empty');
  });
});
