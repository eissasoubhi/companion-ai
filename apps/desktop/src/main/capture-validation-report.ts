import {
  CAPTURE_VALIDATION_TARGETS,
  buildCaptureValidationMatrix,
  type CaptureValidationTarget,
} from './capture-validation-evidence.js';

export const CAPTURE_VALIDATION_REPORT_SCHEMA_VERSION = 1 as const;

type VerifiedTargetReport = {
  target: CaptureValidationTarget;
  status: 'verified';
  recordedAt: string;
  appVersion?: string;
  startupLatencyMs: {
    local: number;
    remote: number;
  };
};

type MissingTargetReport = {
  target: CaptureValidationTarget;
  status: 'missing';
};

export type CaptureValidationTargetReport = VerifiedTargetReport | MissingTargetReport;

export type CaptureValidationReport = {
  schemaVersion: typeof CAPTURE_VALIDATION_REPORT_SCHEMA_VERSION;
  ready: boolean;
  platform: null | {
    os: 'macos';
    version: string;
    arch: 'arm64' | 'x64';
  };
  targets: readonly CaptureValidationTargetReport[];
  missingTargets: readonly CaptureValidationTarget[];
  maxStartupLatencyMs: null | {
    local: number;
    remote: number;
  };
};

export function buildCaptureValidationReport(values: readonly unknown[]): CaptureValidationReport {
  const matrix = buildCaptureValidationMatrix(values);
  const firstEvidence = matrix.evidence.values().next().value;

  let maxLocal: number | null = null;
  let maxRemote: number | null = null;

  const targets = CAPTURE_VALIDATION_TARGETS.map<CaptureValidationTargetReport>((target) => {
    const evidence = matrix.evidence.get(target);
    if (!evidence) return { target, status: 'missing' };

    maxLocal = Math.max(maxLocal ?? 0, evidence.capture.local.startupLatencyMs);
    maxRemote = Math.max(maxRemote ?? 0, evidence.capture.remote.startupLatencyMs);

    return {
      target,
      status: 'verified',
      recordedAt: evidence.recordedAt,
      ...(evidence.app.version === undefined ? {} : { appVersion: evidence.app.version }),
      startupLatencyMs: {
        local: evidence.capture.local.startupLatencyMs,
        remote: evidence.capture.remote.startupLatencyMs,
      },
    };
  });

  return {
    schemaVersion: CAPTURE_VALIDATION_REPORT_SCHEMA_VERSION,
    ready: matrix.ready,
    platform: firstEvidence
      ? {
          os: 'macos',
          version: firstEvidence.platform.version,
          arch: firstEvidence.platform.arch,
        }
      : null,
    targets,
    missingTargets: matrix.missingTargets,
    maxStartupLatencyMs:
      maxLocal === null || maxRemote === null
        ? null
        : {
            local: maxLocal,
            remote: maxRemote,
          },
  };
}
