import { describe, it, expect } from 'vitest';
import { renderPortal } from './page.js';

describe('renderPortal', () => {
  const html = renderPortal();

  it('is a complete HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('wires every §14 endpoint the portal drives', () => {
    for (const path of ['/intent', '/route', '/execute', '/approval/resolve', '/otp/relay', '/workflow/']) {
      expect(html).toContain(path);
    }
  });

  it('offers approve, reject, and OTP relay controls', () => {
    expect(html).toContain('id="approveBtn"');
    expect(html).toContain('id="rejectBtn"');
    expect(html).toContain('id="otpBtn"');
  });

  it('never embeds a secret-bearing input field', () => {
    // The portal renders intent/route/status only — it collects no card/PII secret.
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('name="card_number"');
    expect(html).not.toContain('name="card_cvv"');
    expect(html).not.toContain('id="cvv"');
  });
});
