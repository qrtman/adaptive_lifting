// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NumberStepper } from './NumberStepper';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

function Harness({ start }: { start: number | null }) {
  const [value, setValue] = useState<number | null>(start);
  return <NumberStepper label="Week" value={value} onChange={setValue} testId="week" />;
}

const render = async (start: number | null) => { await act(async () => root.render(<Harness start={start} />)); };
const input = () => container.querySelector<HTMLInputElement>('[data-testid="week"]')!;
const click = async (id: string) => {
  await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click(); });
};
const type = async (text: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('NumberStepper', () => {
  it('steps up from empty to 1 and back down to empty', async () => {
    await render(null);
    expect(input().value).toBe('');
    await click('week-inc');
    expect(input().value).toBe('1');
    await click('week-inc');
    expect(input().value).toBe('2');
    await click('week-dec');
    await click('week-dec');
    expect(input().value).toBe('');
  });

  it('keeps digits only', async () => {
    await render(null);
    await type('wk12');
    expect(input().value).toBe('12');
    await type('Week one');
    expect(input().value).toBe('');
  });

  it('steps with arrow keys', async () => {
    await render(3);
    await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    expect(input().value).toBe('4');
    await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(input().value).toBe('3');
  });
});
