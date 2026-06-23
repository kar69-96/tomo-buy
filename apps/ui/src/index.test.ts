import { describe, it, expect, vi } from 'vitest';
import { startUi } from './index.js';

describe('startUi', () => {
  it('boots the api server and returns a closable handle, printing the URL', async () => {
    const close = vi.fn(async () => {});
    const start = vi.fn(async () => ({ url: 'http://localhost:8787', port: 8787, close }));
    const logs: string[] = [];

    const server = await startUi({ start, logger: (m) => logs.push(m) });

    expect(start).toHaveBeenCalledTimes(1);
    expect(server.url).toBe('http://localhost:8787');
    expect(logs.join('\n')).toContain('http://localhost:8787');

    await server.close();
    expect(close).toHaveBeenCalled();
  });

  it('uses the default stdout logger when none is supplied', async () => {
    const start = vi.fn(async () => ({ url: 'http://localhost:8787', port: 8787, close: async () => {} }));
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      await startUi({ start });
    } finally {
      spy.mockRestore();
    }
    expect(writes.join('')).toContain('http://localhost:8787');
  });

  it('passes server options through, stripping the ui-only fields', async () => {
    const start = vi.fn(async () => ({ url: 'x', port: 1, close: async () => {} }));
    const complete = async () => '{}';
    await startUi({ start, logger: () => {}, complete });

    const passed = start.mock.calls[0]![0]!;
    expect(passed).not.toHaveProperty('start');
    expect(passed).not.toHaveProperty('logger');
    expect(passed).toHaveProperty('complete');
  });
});
