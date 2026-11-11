// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlockPicker, distinctBlocks, existingBlock, resolveBlockName } from './BlockPicker';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('block names', () => {
  it('lists each block once, ignoring case', () => {
    expect(distinctBlocks(['Hypertrophy', 'hypertrophy', null, ' Peak ', ''])).toEqual(['Hypertrophy', 'Peak']);
  });

  it('only treats a block as existing when a session still uses it', () => {
    expect(existingBlock('hypertrophy', ['Hypertrophy'])).toBe('Hypertrophy');
    expect(existingBlock('Hypertrophy', [])).toBeNull();
    expect(existingBlock('', ['Hypertrophy'])).toBeNull();
  });

  it('reuses the existing spelling for a typed name', () => {
    expect(resolveBlockName('hypertrophy ', ['Hypertrophy'])).toBe('Hypertrophy');
    expect(resolveBlockName('Deload', ['Hypertrophy'])).toBe('Deload');
    expect(resolveBlockName('  ', ['Hypertrophy'])).toBeNull();
  });
});

describe('BlockPicker', () => {
  let root: Root;
  let container: HTMLDivElement;
  let picked: Array<string | null>;
  beforeEach(async () => {
    picked = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(
      <BlockPicker value="Hypertrophy" blocks={['Hypertrophy', 'Peak']} onChange={(next) => picked.push(next)} testId="block" />,
    ));
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  const select = () => container.querySelector<HTMLSelectElement>('[data-testid="block"]')!;
  const choose = async (value: string) => {
    await act(async () => {
      select().value = value;
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('shows the current block and offers No block and New block', async () => {
    expect(select().value).toBe('Hypertrophy');
    expect([...select().options].map((option) => option.text)).toEqual(['No block', 'Hypertrophy', 'Peak', 'New block…']);
    await choose('');
    expect(picked).toEqual([null]);
  });

  it('a new block that matches an existing one keeps the existing spelling', async () => {
    await choose('__new__');
    const field = container.querySelector<HTMLInputElement>('[data-testid="block-new"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(field, 'peak');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(picked.at(-1)).toBe('Peak');
  });
});
