export interface DisconnectableBenchmarkSocket {
  close(code?: number, reason?: string): void;
}

export interface ControlledDisconnectOptions {
  readonly closeCode?: number | undefined;
  readonly reason?: string | undefined;
}

export interface ControlledDisconnectSocketFactory<TSocket extends DisconnectableBenchmarkSocket> {
  readonly createSocket: (...args: never[]) => TSocket;
  triggerDisconnect(): void;
}

function requireRetryableCloseCode(value: number): number {
  if (!Number.isInteger(value) || value < 1000 || value > 4999 || value === 1000) {
    throw new RangeError('controlled disconnect closeCode must be a non-normal WebSocket close code');
  }
  return value;
}

function requireCanonicalReason(value: string): string {
  if (value.length === 0) throw new Error('controlled disconnect reason must not be empty');
  if (value.trim() !== value) throw new Error('controlled disconnect reason must be canonical');
  return value;
}

/**
 * Wraps a provider socket factory so an operational benchmark can force the
 * currently active transport closed without exposing provider credentials or
 * reaching into renderer code. The next provider reconnect creates a fresh
 * socket through the original factory.
 */
export function createControlledDisconnectSocketFactory<
  TArgs extends readonly unknown[],
  TSocket extends DisconnectableBenchmarkSocket,
>(
  createSocket: (...args: TArgs) => TSocket,
  options: ControlledDisconnectOptions = {},
): {
  readonly createSocket: (...args: TArgs) => TSocket;
  triggerDisconnect(): void;
} {
  const closeCode = requireRetryableCloseCode(options.closeCode ?? 1012);
  const reason = requireCanonicalReason(options.reason ?? 'benchmark-controlled-disconnect');
  let activeSocket: TSocket | null = null;

  return {
    createSocket: (...args) => {
      const socket = createSocket(...args);
      activeSocket = socket;
      return socket;
    },
    triggerDisconnect: () => {
      if (activeSocket === null) {
        throw new Error('controlled disconnect requested before a provider socket was created');
      }
      const socket = activeSocket;
      activeSocket = null;
      socket.close(closeCode, reason);
    },
  };
}
