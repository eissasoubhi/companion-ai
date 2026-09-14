import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

import type { GroundingSourceKind } from '@companion-ai/contracts';
import type { ContextVerificationStatus, VerifiedContextItem } from '@companion-ai/grounding';

const DEFAULT_MAX_FILE_BYTES = 1_048_576;
const MAX_ITEMS = 128;
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 256;
const MAX_TEXT_LENGTH = 20_000;
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 64;

const groundingKinds = new Set<GroundingSourceKind>([
  'prepared-answer',
  'verified-story',
  'profile-fact',
  'cv',
  'document',
  'job-description',
]);
const verificationStatuses = new Set<ContextVerificationStatus>([
  'verified',
  'draft',
  'archived',
]);

interface VerifiedContextDocument {
  readonly version: 1;
  readonly items: readonly VerifiedContextItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must not be empty.`);
  if (normalized.length > maxLength) {
    throw new Error(`${field} exceeds the ${maxLength} character limit.`);
  }
  return normalized;
}

function parseTags(value: unknown, itemIndex: number): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`items[${itemIndex}].tags must be an array.`);
  if (value.length > MAX_TAGS) {
    throw new Error(`items[${itemIndex}].tags exceeds the ${MAX_TAGS} tag limit.`);
  }

  const tags = value.map((tag, tagIndex) =>
    requiredBoundedString(
      tag,
      `items[${itemIndex}].tags[${tagIndex}]`,
      MAX_TAG_LENGTH,
    ),
  );

  if (new Set(tags).size !== tags.length) {
    throw new Error(`items[${itemIndex}].tags contains duplicates.`);
  }
  return tags;
}

function parseItem(value: unknown, itemIndex: number): VerifiedContextItem {
  if (!isRecord(value)) throw new Error(`items[${itemIndex}] must be an object.`);

  const id = requiredBoundedString(value.id, `items[${itemIndex}].id`, MAX_ID_LENGTH);
  const label = requiredBoundedString(
    value.label,
    `items[${itemIndex}].label`,
    MAX_LABEL_LENGTH,
  );
  const text = requiredBoundedString(
    value.text,
    `items[${itemIndex}].text`,
    MAX_TEXT_LENGTH,
  );

  if (typeof value.kind !== 'string' || !groundingKinds.has(value.kind as GroundingSourceKind)) {
    throw new Error(`items[${itemIndex}].kind is not supported.`);
  }
  if (
    typeof value.status !== 'string' ||
    !verificationStatuses.has(value.status as ContextVerificationStatus)
  ) {
    throw new Error(`items[${itemIndex}].status is not supported.`);
  }

  const tags = parseTags(value.tags, itemIndex);
  return {
    id,
    kind: value.kind as GroundingSourceKind,
    label,
    text,
    status: value.status as ContextVerificationStatus,
    ...(tags === undefined ? {} : { tags }),
  };
}

export function parseVerifiedContextDocument(value: unknown): VerifiedContextDocument {
  if (!isRecord(value)) throw new Error('Verified context document must be an object.');
  if (value.version !== 1) throw new Error('Verified context document version must be 1.');
  if (!Array.isArray(value.items)) throw new Error('Verified context document items must be an array.');
  if (value.items.length > MAX_ITEMS) {
    throw new Error(`Verified context document exceeds the ${MAX_ITEMS} item limit.`);
  }

  const items = value.items.map(parseItem);
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Verified context document contains duplicate item IDs.');
  }

  return { version: 1, items };
}

function readBoundedUtf8File(filePath: string, maxFileBytes: number): string {
  const descriptor = openSync(filePath, 'r');
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error('Verified context path must point to a regular file.');
    if (stats.size > maxFileBytes) {
      throw new Error(`Verified context file exceeds the ${maxFileBytes} byte limit.`);
    }

    const buffer = Buffer.allocUnsafe(maxFileBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxFileBytes) {
      throw new Error(`Verified context file exceeds the ${maxFileBytes} byte limit.`);
    }
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function loadVerifiedContextFromFile(
  filePath: string,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
): readonly VerifiedContextItem[] {
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new Error('maxFileBytes must be a positive safe integer.');
  }

  const raw = readBoundedUtf8File(filePath, maxFileBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Verified context file is not valid JSON.');
  }

  return parseVerifiedContextDocument(parsed).items;
}

export function loadVerifiedContextFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): readonly VerifiedContextItem[] {
  const filePath = environment.COMPANION_VERIFIED_CONTEXT_PATH?.trim();
  if (!filePath) return [];
  return loadVerifiedContextFromFile(filePath);
}
