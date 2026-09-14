import { describe, expect, it } from 'vitest';

import { createTrustedIpcSenderGuard } from './ipc-security.js';

function event(url?: string) {
  return {
    senderFrame: url === undefined ? null : { url },
  } as never;
}

describe('createTrustedIpcSenderGuard', () => {
  it('accepts the exact packaged renderer entry URL', () => {
    const guard = createTrustedIpcSenderGuard('file:///Applications/Companion%20AI/renderer/index.html');
    expect(() => guard(event('file:///Applications/Companion%20AI/renderer/index.html'))).not.toThrow();
  });

  it('rejects missing, remote and sibling renderer senders', () => {
    const guard = createTrustedIpcSenderGuard('file:///app/renderer/index.html');

    expect(() => guard(event())).toThrow('without a trusted sender frame');
    expect(() => guard(event('https://example.com/'))).toThrow('untrusted renderer');
    expect(() => guard(event('file:///app/renderer/other.html'))).toThrow('untrusted renderer');
  });

  it('does not trust query strings or fragments on the renderer entry', () => {
    const guard = createTrustedIpcSenderGuard('file:///app/renderer/index.html');

    expect(() => guard(event('file:///app/renderer/index.html?admin=1'))).toThrow('untrusted renderer');
    expect(() => guard(event('file:///app/renderer/index.html#child'))).toThrow('untrusted renderer');
  });

  it('fails closed if the configured trusted URL is not a plain file URL', () => {
    expect(() => createTrustedIpcSenderGuard('https://example.com/')).toThrow('file protocol');
    expect(() => createTrustedIpcSenderGuard('file:///app/index.html?x=1')).toThrow('query parameters');
  });
});
