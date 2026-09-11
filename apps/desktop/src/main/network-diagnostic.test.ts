import { describe, expect, it, vi } from 'vitest';

import { runNetworkDiagnostic } from './network-diagnostic.js';

describe('runNetworkDiagnostic', () => {
  it('marks a reachable endpoint ready even when it returns a client/auth status', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const times = [100, 142];

    const result = await runNetworkDiagnostic({
      url: 'https://api.eu.deepgram.com/v1/listen',
      fetchImpl,
      clock: () => times.shift() ?? 142,
    });

    expect(result).toEqual({
      state: 'ready',
      host: 'api.eu.deepgram.com',
      latencyMs: 42,
      httpStatus: 401,
      message: 'Realtime endpoint reachable in 42 ms.',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('blocks on provider 5xx responses', async () => {
    const result = await runNetworkDiagnostic({
      url: 'https://api.eu.deepgram.com/v1/listen',
      fetchImpl: async () => new Response(null, { status: 503 }),
      clock: () => 100,
    });

    expect(result.state).toBe('blocked');
    expect(result.httpStatus).toBe(503);
    expect(result.action).toContain('provider status');
  });

  it('blocks network failures with actionable guidance', async () => {
    const result = await runNetworkDiagnostic({
      url: 'https://api.eu.deepgram.com/v1/listen',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });

    expect(result.state).toBe('blocked');
    expect(result.message).toContain('fetch failed');
    expect(result.action).toContain('VPN');
  });

  it('rejects non-HTTPS probe configuration without making a request', async () => {
    const fetchImpl = vi.fn();
    const result = await runNetworkDiagnostic({
      url: 'http://localhost:3000/health',
      fetchImpl,
    });

    expect(result.state).toBe('error');
    expect(result.message).toContain('HTTPS');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
