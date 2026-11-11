// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getRecentBlock, setRecentBlock } from './uiPrefs';

describe('remembered block', () => {
  beforeEach(() => localStorage.clear());

  it('is forgotten when set to empty ("No block")', () => {
    setRecentBlock('athlete-1', 'Hypertrophy');
    expect(getRecentBlock('athlete-1')).toBe('Hypertrophy');
    setRecentBlock('athlete-1', null);
    expect(getRecentBlock('athlete-1')).toBe('');
  });
});
