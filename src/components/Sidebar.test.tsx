// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'ATHLETE', email: 'a@example.test' }, roleMode: 'athlete', signOut: vi.fn() }),
}));
vi.mock('./AthleteScopeSelector', () => ({ AthleteScopeSelector: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () => {
    root.render(
      <Sidebar
        dashboardMode="calendar"
        onNavigate={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        theme="light"
        onToggleTheme={vi.fn()}
      />,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllEnvs();
});

describe('Sidebar integrations flag', () => {
  it('hides Integrations when VITE_INTEGRATIONS_ENABLED is false', async () => {
    vi.stubEnv('VITE_INTEGRATIONS_ENABLED', 'false');
    await render();
    expect(container.querySelector('[data-testid="nav-integrations"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-security"]')).not.toBeNull();
  });

  it('shows Integrations when VITE_INTEGRATIONS_ENABLED is true', async () => {
    vi.stubEnv('VITE_INTEGRATIONS_ENABLED', 'true');
    await render();
    expect(container.querySelector('[data-testid="nav-integrations"]')).not.toBeNull();
  });
});
