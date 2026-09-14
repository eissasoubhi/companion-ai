import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildCaptureValidationReport, type CaptureValidationReport } from './capture-validation-report.js';

export const MAX_CAPTURE_EVIDENCE_FILE_BYTES = 64 * 1024;
export const MAX_CAPTURE_EVIDENCE_FILES = 4;

export type CaptureValidationCliResult = {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
};

async function readBoundedUtf8File(path: string, index: number): Promise<string> {
  const handle = await open(path, 'r');

  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error(`Evidence input ${index + 1} must be a regular file.`);
    }
    if (metadata.size > MAX_CAPTURE_EVIDENCE_FILE_BYTES) {
      throw new Error(`Evidence input ${index + 1} exceeds the ${MAX_CAPTURE_EVIDENCE_FILE_BYTES}-byte limit.`);
    }

    const buffer = Buffer.alloc(MAX_CAPTURE_EVIDENCE_FILE_BYTES + 1);
    let offset = 0;

    while (offset <= MAX_CAPTURE_EVIDENCE_FILE_BYTES) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      if (offset > MAX_CAPTURE_EVIDENCE_FILE_BYTES) {
        throw new Error(`Evidence input ${index + 1} exceeds the ${MAX_CAPTURE_EVIDENCE_FILE_BYTES}-byte limit.`);
      }
    }

    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}

function parseEvidenceDocument(text: string, index: number): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Evidence input ${index + 1} is not valid JSON.`);
  }
}

export async function buildCaptureValidationReportFromFiles(paths: readonly string[]): Promise<CaptureValidationReport> {
  if (paths.length === 0) throw new Error('At least one capture validation evidence file is required.');
  if (paths.length > MAX_CAPTURE_EVIDENCE_FILES) {
    throw new Error(`At most ${MAX_CAPTURE_EVIDENCE_FILES} capture validation evidence files are accepted.`);
  }

  const values: unknown[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const text = await readBoundedUtf8File(paths[index]!, index);
    values.push(parseEvidenceDocument(text, index));
  }

  return buildCaptureValidationReport(values);
}

export async function runCaptureValidationCli(paths: readonly string[]): Promise<CaptureValidationCliResult> {
  try {
    const report = await buildCaptureValidationReportFromFiles(paths);
    return {
      exitCode: report.ready ? 0 : 2,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
      stderr: report.ready ? '' : `Capture validation is incomplete: ${report.missingTargets.join(', ')}.\n`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown capture validation error.';
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Capture validation failed: ${message}\n`,
    };
  }
}

async function main(): Promise<void> {
  const result = await runCaptureValidationCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
