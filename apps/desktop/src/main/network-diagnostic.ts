export type NetworkDiagnosticState = 'ready' | 'blocked' | 'error';

export interface NetworkDiagnosticResult {
  readonly state: NetworkDiagnosticState;
  readonly host: string;
  readonly latencyMs?: number | undefined;
  readonly httpStatus?: number | undefined;
  readonly message: string;
  readonly action?: string | undefined;
}

export interface NetworkProbeOptions {
  readonly url?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly clock?: (() => number) | undefined;
}

const DEFAULT_REALTIME_PROBE_URL = 'https://api.eu.deepgram.com/v1/listen';
const DEFAULT_TIMEOUT_MS = 4_000;

function configuredUrl(value?: string): URL {
  const url = new URL(value ?? DEFAULT_REALTIME_PROBE_URL);
  if (url.protocol !== 'https:') {
    throw new Error('Realtime probe URL must use HTTPS.');
  }
  return url;
}

function blockedResult(host: string, message: string, action: string): NetworkDiagnosticResult {
  return {
    state: 'blocked',
    host,
    message,
    action,
  };
}

export async function runNetworkDiagnostic(
  options: NetworkProbeOptions = {},
): Promise<NetworkDiagnosticResult> {
  let url: URL;
  try {
    url = configuredUrl(options.url ?? process.env.COMPANION_REALTIME_PROBE_URL);
  } catch (error) {
    return {
      state: 'error',
      host: 'invalid configuration',
      message: error instanceof Error ? error.message : 'Realtime probe URL is invalid.',
      action: 'Configure COMPANION_REALTIME_PROBE_URL with a valid HTTPS endpoint.',
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      state: 'error',
      host: url.host,
      message: 'Realtime probe timeout is invalid.',
      action: 'Use a positive timeout value for the realtime diagnostic.',
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.clock ?? (() => performance.now());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const startedAtMs = clock();

  try {
    const response = await fetchImpl(url, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, Math.round(clock() - startedAtMs));

    // A 4xx response is enough for this transport-level diagnostic: DNS, TCP,
    // TLS and HTTP all succeeded. Credential/provider handshake checks are a
    // separate layer and must not require secrets in the renderer.
    if (response.status >= 500) {
      return {
        state: 'blocked',
        host: url.host,
        latencyMs,
        httpStatus: response.status,
        message: `The realtime endpoint responded with HTTP ${response.status}.`,
        action: 'Try again shortly or check the provider status before starting a live session.',
      };
    }

    return {
      state: 'ready',
      host: url.host,
      latencyMs,
      httpStatus: response.status,
      message: `Realtime endpoint reachable in ${latencyMs} ms.`,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return blockedResult(
        url.host,
        `Realtime endpoint did not respond within ${timeoutMs} ms.`,
        'Check your connection, VPN or firewall, then run diagnostics again.',
      );
    }

    const detail = error instanceof Error ? error.message : 'Unknown network error';
    return blockedResult(
      url.host,
      `Could not reach the realtime endpoint: ${detail}`,
      'Check internet access, DNS, VPN and firewall settings, then run diagnostics again.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
