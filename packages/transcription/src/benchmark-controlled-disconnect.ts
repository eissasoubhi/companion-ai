export interface DisconnectableBenchmarkSocket {
  close(code?: number, reason?: string): void;
}

export interface ControlledDisconnectOptions {
  readonly closeCode?: 1011 | 1012 | 1013 | undefined;
  readonly reason?: string | undefined;
}

function requireRetryableCloseCode(value: number): 1011 | 1012 | 1013 {
  if (value !== 1011 && value !== 1012 && value !== 1013) {
    throw new RangeError('controlled disconnect closeCode must be retryable by every STT adapter');
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
