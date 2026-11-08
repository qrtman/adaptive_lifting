// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataExportPanel, exportFilename } from './DataExportPanel';

const { sync, api } = vi.hoisted(() => ({
  sync: { isOnline: true },
  api: { downloadExportCSV: vi.fn(), downloadExportJSON: vi.fn() },
}));
vi.mock('../contexts/SyncContext', () => ({ useSync: () => sync }));
vi.mock('../services/api', () => ({ apiService: api }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

const button = (format: 'csv' | 'json') =>
  container.querySelector(`[data-testid="export-${format}"]`) as HTMLButtonElement;

async function render() { await act(async () => { root.render(<DataExportPanel />); }); }

beforeEach(() => {
  sync.isOnline = true;
  api.downloadExportCSV.mockReset();
  api.downloadExportJSON.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:export');
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('DataExportPanel', () => {
  it('downloads CSV and JSON through the export client', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    api.downloadExportCSV.mockResolvedValue(new Blob(['a,b']));
    api.downloadExportJSON.mockResolvedValue(new Blob(['{}']));
    await render();
    expect(container.textContent).toContain('Download my data');

    await act(async () => { button('csv').click(); });
    await act(async () => { button('json').click(); });

    expect(api.downloadExportCSV).toHaveBeenCalledTimes(1);
    expect(api.downloadExportJSON).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
    expect(container.querySelector('[data-testid="export-error"]')).toBeNull();
  });

  it('shows a loading state and blocks a second export while one runs', async () => {
    let resolve!: (blob: Blob) => void;
    api.downloadExportJSON.mockReturnValue(new Promise<Blob>((r) => { resolve = r; }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await render();

    await act(async () => { button('json').click(); });
    expect(button('json').textContent).toContain('Preparing');
    expect(button('json').disabled).toBe(true);
    expect(button('csv').disabled).toBe(true);

    await act(async () => { resolve(new Blob(['{}'])); });
    expect(button('json').textContent).toContain('Download JSON');
    expect(button('csv').disabled).toBe(false);
  });

  it('shows the error and lets the user retry', async () => {
    api.downloadExportCSV.mockRejectedValue(new Error('CSV export download failed'));
    await render();
    await act(async () => { button('csv').click(); });
    expect(container.querySelector('[data-testid="export-error"]')?.textContent).toContain('CSV export download failed');
    expect(button('csv').disabled).toBe(false);
  });

  it('disables both buttons with explanatory copy when offline', async () => {
    sync.isOnline = false;
    await render();
    expect(button('csv').disabled).toBe(true);
    expect(button('json').disabled).toBe(true);
    expect(container.querySelector('[data-testid="export-offline"]')?.textContent).toContain('offline');
    expect(api.downloadExportCSV).not.toHaveBeenCalled();
  });

  it('names files by format and date', () => {
    expect(exportFilename('csv', new Date('2026-11-08T12:00:00Z'))).toBe('adaptive-lifting-export-2026-11-08.csv');
  });
});
