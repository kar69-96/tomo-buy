// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getAtomicSwapScript } from './placeholder.js';

/** Run the VERBATIM atomic-swap script against the current happy-dom document. */
function runSwap(swapMap: Record<string, string>): void {
  // eslint-disable-next-line no-eval
  const fn = eval(getAtomicSwapScript()) as (m: Record<string, string>) => void;
  fn(swapMap);
}

describe('getAtomicSwapScript against a real DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="checkout">
        <input name="card_number" value="{{card_number}}" />
        <input name="email" value="{{email}}" />
        <input name="untouched" value="leave-me" />
        <button type="submit">Pay</button>
      </form>`;
  });

  it('swaps placeholder markers for real values and leaves others alone', () => {
    runSwap({ '{{card_number}}': '4111111111110042', '{{email}}': 'ada@example.com' });
    expect((document.querySelector('[name="card_number"]') as HTMLInputElement).value).toBe(
      '4111111111110042',
    );
    expect((document.querySelector('[name="email"]') as HTMLInputElement).value).toBe(
      'ada@example.com',
    );
    expect((document.querySelector('[name="untouched"]') as HTMLInputElement).value).toBe(
      'leave-me',
    );
  });

  it('fires input and change events on swapped fields', () => {
    let inputs = 0;
    let changes = 0;
    const el = document.querySelector('[name="card_number"]') as HTMLInputElement;
    el.addEventListener('input', () => (inputs += 1));
    el.addEventListener('change', () => (changes += 1));
    runSwap({ '{{card_number}}': '4111111111110042' });
    expect(inputs).toBe(1);
    expect(changes).toBe(1);
  });

  it('clicks the submit button', () => {
    let submitted = false;
    const form = document.querySelector('#checkout') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    runSwap({ '{{card_number}}': '4111111111110042' });
    expect(submitted).toBe(true);
  });
});
