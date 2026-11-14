// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCollapsedLifts } from './useCollapsedLifts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof useCollapsedLifts>;

function stubWidth(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('767px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
function Probe() {
  api = useCollapsedLifts();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
});

describe('useCollapsedLifts', () => {
  it('phone: every lift starts minimized; opening one keeps it open', async () => {
    stubWidth(true);
    await act(async () => root.render(<Probe />));
    expect(api.isCollapsed('a')).toBe(true);
    expect(api.isCollapsed('b')).toBe(true);
    await act(async () => { api.setCollapsed('a', false); });
    expect(api.isCollapsed('a')).toBe(false);
    expect(api.isCollapsed('b')).toBe(true);
    await act(async () => { api.setMany(['a', 'b'], false); });
    expect(api.isCollapsed('b')).toBe(false);
    await act(async () => { api.setMany(['a', 'b'], true); });
    expect(api.isCollapsed('a')).toBe(true);
  });

  it('desktop: lifts start open and a collapse is remembered', async () => {
    stubWidth(false);
    await act(async () => root.render(<Probe />));
    expect(api.isCollapsed('a')).toBe(false);
    await act(async () => { api.setCollapsed('a', true); });
    expect(api.isCollapsed('a')).toBe(true);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => root.render(<Probe />));
    expect(api.isCollapsed('a')).toBe(true);
  });
});
