export const CAPTURE_VALIDATION_SCHEMA_VERSION = 1 as const;

export const CAPTURE_VALIDATION_TARGETS = [
  'browser-media',
  'google-meet',
  'microsoft-teams',
  'zoom',
] as const;

export type CaptureValidationTarget = (typeof CAPTURE_VALIDATION_TARGETS)[number];

type CaptureChannelEvidence = {
  opened: true;
  liveTrack: true;
  signalDetected: true;
  startupLatencyMs: number;
};

export type CaptureValidationEvidence = {
  schemaVersion: typeof CAPTURE_VALIDATION_SCHEMA_VERSION;
  recordedAt: string;
  platform: {
    os: 'macos';
    version: string;
    arch: 'arm64' | 'x64';
  };
  app: {
    target: CaptureValidationTarget;
    version?: string;
  };
  capture: {
    local: CaptureChannelEvidence;
    remote: CaptureChannelEvidence;
  };
  rawAudioPersisted: false;
  notes?: string;
};

export type CaptureValidationMatrix = {
  ready: boolean;
  evidence: ReadonlyMap<CaptureValidationTarget, CaptureValidationEvidence>;
  missingTargets: readonly CaptureValidationTarget[];
};

const MAX_STARTUP_LATENCY_MS = 30_000;
const MAX_NOTES_LENGTH = 2_000;
const MAX_VERSION_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function requireString(value: unknown, field: string, maxLength = MAX_VERSION_LENGTH): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new Error(`${field} must contain between 1 and ${maxLength} characters.`);
  }
  return trimmed;
}

function requireRecordedAt(value: unknown): string {
  const recordedAt = requireString(value, 'recordedAt', 64);
  const timestamp = Date.parse(recordedAt);
  if (!Number.isFinite(timestamp) || !recordedAt.includes('T')) {
    throw new Error('recordedAt must be an ISO-8601 timestamp.');
  }
  return recordedAt;
}

function parseChannel(value: unknown, field: 'local' | 'remote'): CaptureChannelEvidence {
  if (!isRecord(value) || !hasOnlyKeys(value, ['opened', 'liveTrack', 'signalDetected', 'startupLatencyMs'])) {
    throw new Error(`capture.${field} has an invalid shape.`);
  }
  if (value.opened !== true || value.liveTrack !== true || value.signalDetected !== true) {
    throw new Error(`capture.${field} must prove opened capture, a live track and detected signal.`);
  }
  if (!Number.isInteger(value.startupLatencyMs) || (value.startupLatencyMs as number) < 0 || (value.startupLatencyMs as number) > MAX_STARTUP_LATENCY_MS) {
    throw new Error(`capture.${field}.startupLatencyMs must be an integer between 0 and ${MAX_STARTUP_LATENCY_MS}.`);
  }
  return { opened: true, liveTrack: true, signalDetected: true, startupLatencyMs: value.startupLatencyMs as number };
}

export function parseCaptureValidationEvidence(value: unknown): CaptureValidationEvidence {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion', 'recordedAt', 'platform', 'app', 'capture', 'rawAudioPersisted', 'notes'])) {
    throw new Error('Capture validation evidence has an invalid shape.');
  }
  if (value.schemaVersion !== CAPTURE_VALIDATION_SCHEMA_VERSION) throw new Error(`schemaVersion must be ${CAPTURE_VALIDATION_SCHEMA_VERSION}.`);
  if (value.rawAudioPersisted !== false) throw new Error('rawAudioPersisted must be false.');
  if (!isRecord(value.platform) || !hasOnlyKeys(value.platform, ['os', 'version', 'arch'])) throw new Error('platform has an invalid shape.');
  if (value.platform.os !== 'macos') throw new Error('platform.os must be macos for the P0 capture validation.');
  if (value.platform.arch !== 'arm64' && value.platform.arch !== 'x64') throw new Error('platform.arch must be arm64 or x64.');
  if (!isRecord(value.app) || !hasOnlyKeys(value.app, ['target', 'version'])) throw new Error('app has an invalid shape.');
  if (!CAPTURE_VALIDATION_TARGETS.includes(value.app.target as CaptureValidationTarget)) throw new Error('app.target is not a supported validation target.');
  if (!isRecord(value.capture) || !hasOnlyKeys(value.capture, ['local', 'remote'])) throw new Error('capture has an invalid shape.');

  const appVersion = value.app.version === undefined ? undefined : requireString(value.app.version, 'app.version');
  const notes = value.notes === undefined ? undefined : requireString(value.notes, 'notes', MAX_NOTES_LENGTH);

  return {
    schemaVersion: CAPTURE_VALIDATION_SCHEMA_VERSION,
    recordedAt: requireRecordedAt(value.recordedAt),
    platform: { os: 'macos', version: requireString(value.platform.version, 'platform.version'), arch: value.platform.arch },
    app: { target: value.app.target as CaptureValidationTarget, ...(appVersion === undefined ? {} : { version: appVersion }) },
    capture: { local: parseChannel(value.capture.local, 'local'), remote: parseChannel(value.capture.remote, 'remote') },
    rawAudioPersisted: false,
    ...(notes === undefined ? {} : { notes }),
  };
}

export function buildCaptureValidationMatrix(values: readonly unknown[]): CaptureValidationMatrix {
  const evidence = new Map<CaptureValidationTarget, CaptureValidationEvidence>();
  let expectedPlatform: CaptureValidationEvidence['platform'] | undefined;

  for (const value of values) {
    const parsed = parseCaptureValidationEvidence(value);
    if (evidence.has(parsed.app.target)) throw new Error(`Duplicate capture validation target: ${parsed.app.target}.`);

    if (!expectedPlatform) {
      expectedPlatform = parsed.platform;
    } else if (expectedPlatform.version !== parsed.platform.version || expectedPlatform.arch !== parsed.platform.arch) {
      throw new Error('All capture validation evidence must come from the same macOS version and architecture.');
    }

    evidence.set(parsed.app.target, parsed);
  }

  const browserEvidence = evidence.get('browser-media');
  if (browserEvidence) {
    const browserTimestamp = Date.parse(browserEvidence.recordedAt);
    for (const target of CAPTURE_VALIDATION_TARGETS) {
      if (target === 'browser-media') continue;
      const targetEvidence = evidence.get(target);
      if (targetEvidence && Date.parse(targetEvidence.recordedAt) < browserTimestamp) {
        throw new Error('browser-media validation must be recorded before Meet, Teams and Zoom.');
      }
    }
  }

  const missingTargets = CAPTURE_VALIDATION_TARGETS.filter((target) => !evidence.has(target));
  return { ready: missingTargets.length === 0, evidence, missingTargets };
}
