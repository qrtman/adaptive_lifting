// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConflictReviewCard } from './ConflictReviewCard';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;

beforeEach(() => {
  node = document.createElement('div');
  document.body.appendChild(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

it('shows the actual server and queued edit values and invokes explicit resolution actions', async () => {
  const keepServer = vi.fn();
  const exportEdit = vi.fn();
  await act(async () => root.render(
    <ConflictReviewCard
      mutationId="mutation-1"
      entityType="ExerciseSet"
      entityId="set-1"
      reason="STALE_REVISION"
      serverFields={{ actual: 105 }}
      clientFields={{ actual: 100 }}
      onKeepServer={keepServer}
      onExport={exportEdit}
    />,
  ));

  expect(node.textContent).toContain('Server · actual');
  expect(node.textContent).toContain('105');
  expect(node.textContent).toContain('Your edit · actual');
  expect(node.textContent).toContain('100');
  const buttons = [...node.querySelectorAll('button')];
  await act(async () => buttons[0].click());
  await act(async () => buttons[1].click());
  expect(keepServer).toHaveBeenCalledOnce();
  expect(exportEdit).toHaveBeenCalledOnce();
});
