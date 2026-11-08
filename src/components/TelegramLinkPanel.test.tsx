// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramLinkPanel } from './TelegramLinkPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

async function render() { await act(async () => { root.render(<TelegramLinkPanel />); }); }

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TelegramLinkPanel', () => {
  it.each([404, 503])('shows a calm not-available state when the server answers %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    await render();
    expect(container.querySelector('[data-testid="telegram-unavailable"]')?.textContent).toContain('Not available yet');
    expect(container.textContent).not.toContain('Ensure backend is running');
  });

  it('shows not available when the request cannot reach the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await render();
    expect(container.textContent).toContain('Not available yet');
  });

  it('keeps the link flow when Telegram is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'disconnected' }), { status: 200 })));
    await render();
    expect(container.textContent).toContain('Generate Linking Token');
    expect(container.querySelector('[data-testid="telegram-unavailable"]')).toBeNull();
  });
});
