import { describe, expect, it } from 'vitest';

import {
  createLiveReconnectProviderConfigs,
  parseLiveReconnectCliArgs,
} from './benchmark-live-reconnect-cli.js';

describe('live reconnect benchmark CLI', () => {
  it('parses the output, sample rate and optional timeout', () => {
    const options = parseLiveReconnectCliArgs(['results/reconnect.json', '24000', '12000']);
    expect(options.outputPath).toMatch(/results\/reconnect\.json$/);
    expect(options.sampleRateHz).toBe(24_000);
    expect(options.timeoutMs).toBe(12_000);
  });

  it('rejects invalid numeric arguments', () => {
    expect(() => parseLiveReconnectCliArgs(['out.json', '0'])).toThrow(/sample-rate-hz/);
    expect(() => parseLiveReconnectCliArgs(['out.json', '24000', 'NaN'])).toThrow(/timeout-ms/);
    expect(() => parseLiveReconnectCliArgs(['out.json'])).toThrow(/usage/);
  });

  it('requires all three credentials before creating live transports', () => {
    expect(() =>
      createLiveReconnectProviderConfigs(
        {
          DEEPGRAM_API_KEY: 'deepgram-secret',
          ASSEMBLYAI_API_KEY: 'assembly-secret',
        },
        24_000,
      ),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('keeps credentials inside socket factories rather than serializable config fields', () => {
    const configs = createLiveReconnectProviderConfigs(
      {
        DEEPGRAM_API_KEY: 'deepgram-secret',
        ASSEMBLYAI_API_KEY: 'assembly-secret',
        OPENAI_API_KEY: 'openai-secret',
      },
      24_000,
    );

    expect(JSON.stringify(configs)).not.toContain('secret');
    expect(configs.deepgram.audioFormat).toEqual({
      encoding: 'pcm-s16le',
      sampleRateHz: 24_000,
      channels: 1,
    });
    expect(configs.assemblyAI.sampleRateHz).toBe(24_000);
    expect(configs.openAI.sampleRateHz).toBe(24_000);
  });
});
