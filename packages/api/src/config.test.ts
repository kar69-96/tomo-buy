import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

const full = {
  AGENTCARD_API_KEY: 'sk_test_123',
  WEBHOOK_SECRET: 'whsec_123',
  VAULT_MASTER_KEY: 'master-key',
  MANDATE_PASSPHRASE: 'pass',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('loads a complete config with sensible defaults', () => {
    const cfg = loadConfig(full);
    expect(cfg.agentcardApiKey).toBe('sk_test_123');
    expect(cfg.temporalAddress).toBe('127.0.0.1:7233');
    expect(cfg.temporalNamespace).toBe('default');
    expect(cfg.port).toBe(8787);
    expect(cfg.agentcardBaseUrl).toBeUndefined();
  });

  it('honors overrides', () => {
    const cfg = loadConfig({
      ...full,
      AGENTCARD_API_BASE: 'https://sandbox.agentcard.test',
      TEMPORAL_ADDRESS: '10.0.0.1:7233',
      PORT: '9000',
    });
    expect(cfg.agentcardBaseUrl).toBe('https://sandbox.agentcard.test');
    expect(cfg.temporalAddress).toBe('10.0.0.1:7233');
    expect(cfg.port).toBe(9000);
  });

  it('throws listing every missing required secret', () => {
    expect(() => loadConfig({})).toThrow(/AGENTCARD_API_KEY/);
    expect(() => loadConfig({ AGENTCARD_API_KEY: 'x' })).toThrow(/WEBHOOK_SECRET/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ ...full, PORT: 'abc' })).toThrow(/invalid PORT/);
  });
});
