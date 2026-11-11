// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComboBox } from './ComboBox';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let picked: string[];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <div data-testid="clip" style={{ overflow: 'hidden', height: 40 }}>
      <ComboBox
        label="Week"
        value={value}
        onChange={(next) => { picked.push(next); setValue(next); }}
        options={['Week 1', 'Week 2']}
        testId="week"
      />
    </div>
  );
}

beforeEach(async () => {
  picked = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const input = () => container.querySelector<HTMLInputElement>('[data-testid="week"]')!;
const list = () => document.querySelector<HTMLElement>('[data-testid="week-listbox"]');

describe('ComboBox list', () => {
  it('opens outside any clipping parent, fixed to the field', async () => {
    await act(async () => { input().focus(); });
    const listbox = list()!;
    expect(listbox).not.toBeNull();
    expect(container.querySelector('[data-testid="clip"]')!.contains(listbox)).toBe(false);
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox.style.position).toBe('fixed');
    expect(input().getAttribute('aria-controls')).toBe(listbox.id);
  });

  it('picks an option on click and closes', async () => {
    await act(async () => { input().focus(); });
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="week-option-Week 2"]')!.click();
    });
    expect(picked).toEqual(['Week 2']);
    expect(list()).toBeNull();
  });

  it('closes on Escape', async () => {
    await act(async () => { input().focus(); });
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(list()).toBeNull();
  });
});
