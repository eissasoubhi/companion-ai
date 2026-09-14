import type { IpcMainInvokeEvent } from 'electron';

export type IpcSenderGuard = (event: Pick<IpcMainInvokeEvent, 'senderFrame'>) => void;

function canonicalTrustedUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Trusted renderer URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'file:') {
    throw new Error('Trusted renderer URL must use the file protocol.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Trusted renderer URL must not contain credentials, query parameters or fragments.');
  }
  return parsed.href;
}

export function createTrustedIpcSenderGuard(expectedRendererUrl: string): IpcSenderGuard {
  const trustedUrl = canonicalTrustedUrl(expectedRendererUrl);

  return (event): void => {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) {
      throw new Error('Blocked IPC request without a trusted sender frame.');
    }

    let canonicalSenderUrl: string;
    try {
      canonicalSenderUrl = new URL(senderUrl).href;
    } catch {
      throw new Error('Blocked IPC request from an invalid sender URL.');
    }

    if (canonicalSenderUrl !== trustedUrl) {
      throw new Error('Blocked IPC request from an untrusted renderer.');
    }
  };
}
